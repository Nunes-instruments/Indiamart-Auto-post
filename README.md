# NUNES IndiaMART Audit Console

A static, no-backend read-only product auditor for the IndiaMART Manage Products page.

## How it works
- `index.html` runs an audit dashboard on Vercel. It does not automatically query the seller's private account.
- `scanner.user.js` runs in the seller's own Tampermonkey-enabled Chrome session, scans product list cards and optionally opens the dashboard. When both tabs are open, it sends snapshots using `window.postMessage` to the exact dashboard origin.
- The dashboard checks the sender origin and `window.opener`; rows live in browser `localStorage`, not a cloud database.
- V6.2 CSV exports can also be imported from the dashboard. Imports have *unverified* completeness.

## Security / limitations
- Do not paste credentials, tokens or customer information into the tool.
- The three seller sessions must be logged into and scanned separately.
- This tool never edits listings or prices.
- A missing card thumbnail is not proof that the listing has no product-gallery images.
- Full-account count requires complete scrolling, correct pagination and both Active/Inactive categories.
- Data is browser-local. Different computers do not share scan results.

## Deployment
A Vercel project linked to the GitHub default branch will serve `index.html` as a static site. No environment variables are required. Install `scanner.user.js` in Tampermonkey with **Allow user scripts** turned on.