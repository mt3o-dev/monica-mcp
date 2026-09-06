/**
 * Seeds the development account with a fantasy cast.
 *
 * Fake data that could never be mistaken for a real person: a leaked dev
 * database is a non-event, and "Grimlock the Bridgetroll" appearing in
 * production is instantly diagnosable.
 *
 * Idempotent — run it as often as you like.
 */
import { loadConfig } from './config.js';
import { MonicaClient } from './monica.js';
import { runStartupChecks } from './startup.js';
import { searchContacts, setNickname, type Contact } from './contacts.js';

interface Fixture {
  first_name: string;
  last_name: string;
  nickname: string | null;
  activities: number;
  exercises: string;
}

const FIXTURES: Fixture[] = [
  { first_name: 'Grimlock', last_name: 'Bridgetroll', nickname: null, activities: 1,
    exercises: 'with Stonefist: tier 3 ambiguity on "Grimlock"; empty nickname so alias write-back offers' },
  { first_name: 'Grimlock', last_name: 'Stonefist', nickname: null, activities: 0,
    exercises: 'the other half of the ambiguity' },
  { first_name: 'Grim', last_name: 'Toadwart', nickname: null, activities: 0,
    exercises: 'exact first name must beat the substring match' },
  { first_name: 'Grimlockson', last_name: 'Ironjaw', nickname: null, activities: 0,
    exercises: 'substring must not silently pick the shortest' },
  { first_name: 'Sparklehoof', last_name: 'Silvermane', nickname: 'Sparky', activities: 0,
    exercises: 'tier 1 must read nickname; nickname set, so alias write-back stays silent' },
  { first_name: 'Thistledown', last_name: 'Moonwhisper', nickname: null, activities: 25,
    exercises: 'pagination in brief_contact (Monica pages at 10)' },
];

async function findByName(client: MonicaClient, f: Fixture): Promise<Contact | undefined> {
  const pool = await searchContacts(client, `${f.first_name} ${f.last_name}`);
  return pool.find(
    (c) => c.first_name === f.first_name && (c.last_name ?? '') === f.last_name,
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new MonicaClient(config.monicaBaseUrl, config.monicaApiToken);

  // Same guard as the server: refuse to write trolls into the wrong account.
  const { user, activityTypes } = await runStartupChecks(config, client);
  console.log(`seeding account ${user.account.id} (${user.email})\n`);

  const activityTypeId = activityTypes[0]!.id;

  for (const f of FIXTURES) {
    let contact = await findByName(client, f);

    if (contact === undefined) {
      const { data } = await client.request<{ data: Contact }>('POST', '/api/contacts', {
        first_name: f.first_name,
        last_name: f.last_name,
        nickname: f.nickname,
        is_birthdate_known: false,
        is_deceased: false,
        is_deceased_date_known: false,
      });
      contact = data;
      console.log(`+ created ${contact.complete_name}`);
    } else {
      console.log(`= exists  ${contact.complete_name}`);
    }

    const wanted = f.nickname ?? '';
    if ((contact.nickname ?? '') !== wanted) {
      contact = await setNickname(client, contact, wanted);
      console.log(`  nickname -> ${wanted === '' ? '(cleared)' : wanted}`);
    }

    const existing = await countActivities(client, contact.id);
    for (let i = existing; i < f.activities; i += 1) {
      await client.request('POST', '/api/activities', {
        activity_type_id: activityTypeId,
        summary: `Encounter ${i + 1} with ${contact.first_name}`,
        description: `Raw capture text for encounter ${i + 1}. Kept verbatim, per ADR 0004.`,
        happened_at: dayOffset(-(i * 7 + 1)),
        contacts: [contact.id],
      });
    }
    if (f.activities > existing) console.log(`  activities -> ${f.activities}`);
    console.log(`  exercises: ${f.exercises}`);
  }

  console.log(`
Done. One thing this script cannot do: set Cadence.
stay_in_touch_frequency is read-only over the API (ADR 0005), so to exercise
find_overdue, open Monica and set "Stay in touch" by hand:
  - Grimlock Stonefist  -> every 7 days   (cadence set, never contacted -> overdue)
  - Grimlock Bridgetroll -> every 365 days (cadence set, recent -> not overdue)
  - Grim Toadwart       -> leave unset    (must never appear in find_overdue)`);
}

async function countActivities(client: MonicaClient, contactId: number): Promise<number> {
  const res = await client.request<{ meta?: { total?: number } }>(
    'GET',
    `/api/contacts/${contactId}/activities?limit=1`,
  );
  return res.meta?.total ?? 0;
}

const dayOffset = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

await main();
