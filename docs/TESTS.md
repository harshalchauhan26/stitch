# Tests

Needs the local MongoDB (`npm run mongo:dev` in `api/`; on Windows add MongoDB's `bin` folder to PATH first), then `npm test` in `api/`.
No mail server, no Groq key and no network are needed: the mail sender and the model are replaced in the tests.

## The numbered pipeline checks: `api/tests/pipelines.test.js`

Each check has an id, so a failing line tells you which pipeline broke. Run only this file with
`node --test --test-concurrency=1 tests/pipelines.test.js`.

| Keyword | Ids | What it proves |
|---|---|---|
| ENDPOINTS | 01-06 | API and database are up; every read route answers 200 for an admin, 401 with no or a bad token, 404 for unknown routes; admin-only routes refuse sales and pod leads; another brand's team gets 404 |
| AUTH | 01-03 | right and wrong password, same error for unknown e-mail, `/me` role and teams |
| LEADS | 01-07 | create, list and audit trail, stale edit 409, stage by stage, Won blocked until the advance link is sent then creates the order, lost and reopen, brand scope |
| MAIL | 01-05 | order mail queued for each team member, worker sends once, a down server retries and then fails and notifies admins, admin sees it and Retry sends it, a sent mail cannot be retried |
| CHAT | 01-05 | WhatsApp export uploaded, read into a lead with proposals (nothing saved yet), accept fills the lead, broken model answer is reported, brand scope |
| ENQUIRY | 01-02 | landing-page form saves a prospect, admin-only list, bad input refused |

The other files (`leads`, `orders`, `fulfilment`, `mail`, `extraction`, ...) test each area in more depth.
