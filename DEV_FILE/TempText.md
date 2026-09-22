TASK 10: Project Verification and Testing

Performed type-checking, PHP linting, Blade compilation, route registration, and local verification of the Online Work authentication and demo sandbox flows. Documented remaining live-server testing and deployment follow-ups.

Kind of Work: Testing
Priority: Normal
Reference: Verification

---

TASK 9: Accounts System — Vietnam Payable Version Switch

Enabled the Vietnam Payable 1.0 tab and added the Payable 1.0 / 1.1 switch. Maintained permission-based access and confirmed that no backend changes were required.

Kind of Work: Development
Priority: Normal
Reference: 91004d5

---

TASK 8: Task Manager — Leader Project Creation

Enabled Leaders to create projects by introducing the tm.project.create permission. Updated the API and UI, while keeping project deletion Manager-only and editing owner-scoped.

Kind of Work: Development
Priority: Normal
Reference: 812cd9d / 3b2e1d

---

TASK 7: Online Work — Demo Sandbox

Created a demo sandbox with 24 demo accounts supporting sign-up, sign-in, password reset, and system usage without writing data to the live database. Tested lockouts, password resets, and duplicate registrations.

Kind of Work: Development
Priority: High
Reference: 9608db6

---

TASK 6: Online Work — Admin and HR Quick Sign-In

Implemented one-tap Admin and HR sign-in buttons. Updated the authentication flow so credentials are handled server-side and removed hardcoded credentials from the page source.

Kind of Work: Development
Priority: High
Reference: 5ab2c75 / 97fc269

---

TASK 5: Accounts System — P&L Quotation Import

Committed the quotation-based P&L import command to handle bookings with missing IS numbers. Added support for quotation numbers, CNTL suffixes, and earlier revisions. A real non-dry-run test remains pending.

Kind of Work: Development
Priority: Normal
Reference: d53d209

---

TASK 4: Accounts System — Remove API Repair Sweep from Board

Removed the Sync Ledger repair sweep from screen-level P&L activity loading. Implemented a read-only screen path, lean activity processing, and improved caching to prevent unnecessary API calls and repair writes when opening the board.

Kind of Work: Bug Fix
Priority: High
Reference: 6d1f71f

---

TASK 3: Accounts System — Fix P&L Production 500 Error

Investigated and fixed the ONLY_FULL_GROUP_BY SQL error on the P&L board. Updated the currency breakdown query and normalised currency values in PHP. The fix was committed for deployment.

Kind of Work: Bug Fix
Priority: High
Reference: acd84ef

---

TASK 2: Accounts System — P&L Board Currency Separation

Updated the P&L KPI tiles to separate USD and INR instead of combining currencies under USD. Added per-currency Sell, Cost, Profit, and Margin calculations with detailed breakdowns.

Kind of Work: Development
Priority: High
Reference: a118147 / dda4683

---

TASK 1: Accounts System — Invoice Payments Period Activity

Implemented the Period Activity strip in the Invoice Payments board with New, New Updates, Old Updates, and Cancelled categories. Connected the counts to the mail's computation so the board and daily email remain consistent. Fixed the 4-vs-3 mismatch caused by a B2C document.

Kind of Work: Development
Priority: High
Reference: cee348d / 431db63