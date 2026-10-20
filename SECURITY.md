# Security

## Reporting a vulnerability

Use the repository's private vulnerability reporting feature under **Security → Report a vulnerability** if it is enabled. Otherwise, contact a maintainer privately through an available maintainer contact channel before sharing exploit details. Do not put passwords, session tokens, database files, personal journal exports, or private deployment configuration in issues or pull requests.

## Deployment assumptions

Rhythm currently has two access boundaries: an owner-private Sites audience and an application administrator session. The Worker trusts the site-scoped identity supplied by the Sites gateway in `oai-authenticated-user-id`. Initial enrollment relies on that trusted gateway and private audience; it is not public registration. A singleton database row prevents repeated or concurrent enrollment.

Keep this upstream boundary in place. The Worker must not be exposed directly where a client can supply its own trusted identity header. Supporting another hosting platform requires a trusted identity integration and a review of enrollment and identity binding. The loopback development server deliberately supplies a local identity and is not a production server.

## Credentials and sessions

- The owner creates a username and password on first use. There is no production default password. Usernames are lowercased ASCII, 3–64 characters. Setup passwords are 15–128 characters with a 512-byte bound.
- Passwords use scrypt with `N=16384`, `r=8`, `p=5`, a random 128-bit salt, and a 256-bit result. Hash comparison uses native HMAC verification. Plaintext passwords are not stored or logged by the application.
- Sessions use independent 256-bit random tokens. D1 stores only their SHA-256 hashes. Sessions bind to the administrator's platform identity.
- The `__Host-rhythm` cookie is `Secure`, `HttpOnly`, `SameSite=Strict`, and scoped to `/`, without a `Domain` attribute. Remembered sessions last 30 days; otherwise the cookie is a browser-session cookie with a 12-hour server expiry. Login rotates the current token; logout revokes it.
- Setup and login share a limit of ten attempts per platform identity per 15-minute fixed window. D1 counts attempts atomically before password hashing. Changing usernames or IP addresses does not reset the counter.
- There is no public password-reset endpoint or recovery email flow. Account recovery requires owner-controlled maintenance.

Authentication POSTs and journal PUTs require an exact same-origin `Origin`, JSON content type, and a custom request header. Cross-site Fetch Metadata is rejected; no cross-origin API access is granted. Authentication request bodies have a 4 KiB streaming limit; journal request bodies have a 2 MiB limit. SQL queries use bound parameters.

## Application access

App HTML and root scripts, including `main.dart.js`, are embedded in the Worker and require a server-verified session. Public static output contains generic renderer, font, and icon assets. Content-hashed script URLs prevent old static-release caches from retaining obsolete startup guards. Worker responses use `private, no-store`, CSP, `nosniff`, `no-referrer`, and framing restrictions. No offline application cache is installed.

The browser revalidates access on load, focus, visibility restoration, and periodically. Absolute expiry has an independent timer, and session checks time out. Expiry or network failure locks a loaded page while retaining its unsaved draft in memory. Reauthentication in another tab can resume that draft. Explicit logout is blocked while changes remain unsaved. Cross-tab logout uses `BroadcastChannel` with a storage-event fallback. WebMCP callbacks check the server before execution and before returning data; callbacks from a locked session are invalidated.

## Journal data

The server stores a journal under the authenticated administrator and its platform identity. Journal reads, writes, and previous-version reads require a valid session; clients cannot supply a different account ID. A conditional SQL write preserves the previous JSON and advances a revision atomically. Stale revisions are rejected, including across browsers.

Server validation mirrors the Dart schema. A 900,000-byte UTF-8 journal limit bounds the combined current and previous payloads. Schema version 2 preserves ordered duration sessions, including repeated category labels. Session sums cannot exceed the daily total, and categories must belong to the habit. Version 1 is accepted without session fields and upgraded by the app. Exporting version 2 prevents old clients from silently discarding session data. Archiving a habit changes its visibility; it does not erase its history.

Legacy IndexedDB migration requires an empty account journal and expected revision zero. If another client saves first, the existing server journal is loaded instead of overwritten. Once the server has a journal, older browser copies never replace it automatically. Network and authentication failures do not present local data as successfully saved.

Legacy browser copies remain on the device. JSON exports and those copies are not encrypted by the app. The account password controls access; it is not an encryption key for stored journal data. Database operators and people with access to exported files or the browser profile may access that data. Logout and clearing browser storage do not delete the server journal.

The development database persists in the ignored `.rhythm-data/d1/` directory. Local and hosted instances use independent databases. Test runtimes are ephemeral unless given a persistence directory. Application code does not embed journal data in static assets or log journal contents; deployment operators must also configure their own logging and backups appropriately.

## Verification and limits

The repository includes tests for password hashing, session expiry and revocation, identity binding, concurrent enrollment, rate limits, CSRF checks, bounded inputs, protected assets, and database failures. Browser lifecycle tests cover stale WebMCP callbacks, logout races, hung requests, retained drafts, and reauthentication. Account-storage tests cover validation, migration, revision conflicts, atomic previous-version backups, and persistence across local database restarts. Worker integration tests run the built bundle with workerd and D1 migrations.

Run the build and test commands in [README.md](README.md) against the revision being deployed. Passing tests are not an independent penetration test, a guarantee of dependency safety, or a review of hosting infrastructure. Deployments need their own access-control, dependency, backup, and recovery review.
