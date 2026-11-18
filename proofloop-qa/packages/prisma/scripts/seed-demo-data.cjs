/**
 * Seeds a realistic demo project ("ProofLoop Shop") into the "ProofLoop Inc" organization so
 * every module of the app has data to show: environments + variables, modules, requirements with
 * acceptance criteria, risks, test cases with steps, test cycles with executions, defects,
 * automation projects with run history, API collections with requests/executions, and a
 * release quality-gate config. Also adds three team members (QA lead, QA engineer, viewer).
 *
 * - Idempotent: upserts on each model's unique key; child lists without a unique key
 *   (acceptance criteria, risks, test steps, API executions) are replaced on every run.
 * - Does NOT touch the "ProofLoop QA Platform" project (docs/ISSUE-LOG.md defects).
 * - Demo users: password comes from SEED_DEMO_PASSWORD (min 8 chars). If unset, a random password
 *   is generated and printed once. Existing users keep their password.
 *
 * Run from repo root:  node packages/prisma/scripts/seed-demo-data.cjs
 */
const path = require('node:path');
const crypto = require('node:crypto');
process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const ORG_NAME = 'ProofLoop Inc';
const PROJECT_NAME = 'ProofLoop Shop';
const PROJECT_DESCRIPTION =
  'Demo e-commerce web shop (seeded by packages/prisma/scripts/seed-demo-data.cjs). ' +
  'Covers auth, catalog, cart, checkout, orders and user profile.';
const ADMIN_EMAIL = 'admin@proofloop.qa';
const BCRYPT_ROUNDS = 12; // same as apps/api auth.controller.ts

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d, hours = 10) => new Date(Date.now() - d * DAY + (hours - 10) * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const USERS = [
  { email: 'lead@proofloop.qa', firstName: 'Sara', lastName: 'Khan', role: 'QA_LEAD' },
  { email: 'engineer@proofloop.qa', firstName: 'Omar', lastName: 'Rehman', role: 'QA_ENGINEER' },
  { email: 'viewer@proofloop.qa', firstName: 'Lina', lastName: 'Park', role: 'VIEWER' },
];

const ENVIRONMENTS = [
  {
    name: 'QA',
    baseUrl: 'https://qa.shop.example.com',
    variables: [
      ['API_VERSION', 'v1'],
      ['DEFAULT_CURRENCY', 'USD'],
      ['TEST_PRODUCT_SKU', 'SKU-1001'],
    ],
  },
  {
    name: 'STAGING',
    baseUrl: 'https://staging.shop.example.com',
    variables: [
      ['API_VERSION', 'v1'],
      ['DEFAULT_CURRENCY', 'USD'],
      ['TEST_PRODUCT_SKU', 'SKU-2001'],
    ],
  },
  { name: 'PRODUCTION', baseUrl: 'https://shop.example.com', variables: [['API_VERSION', 'v1']] },
];

const MODULES = [
  ['Authentication', 'Sign-up, login, logout, password reset and session handling.'],
  ['Product Catalog', 'Product listing, search, filters and product detail pages.'],
  ['Shopping Cart', 'Add/remove items, quantities, cart persistence and promo codes.'],
  ['Checkout & Payments', 'Address, shipping options, payment providers and order placement.'],
  ['Order Management', 'Order history, tracking, cancellation and returns.'],
  ['User Profile', 'Profile details, saved addresses and notification preferences.'],
];

// [reqId, module, title, description, priority, criticality, [acceptance criteria]]
const REQUIREMENTS = [
  ['REQ-001', 'Authentication', 'User registration with email verification',
    'A visitor can create an account with email and password and must verify the email before first login.',
    'HIGH', 'CRITICAL',
    ['Password must be at least 8 characters with one number.', 'A verification email is sent within 1 minute.', 'Unverified accounts cannot log in.']],
  ['REQ-002', 'Authentication', 'Login with email and password',
    'Registered users log in with email and password; the session lasts 7 days.',
    'HIGH', 'CRITICAL',
    ['Email is case-insensitive.', 'Wrong credentials show a generic error.', 'Account locks for 15 minutes after 5 failed attempts.']],
  ['REQ-003', 'Authentication', 'Password reset via email link',
    'Users can request a reset link that expires after 1 hour and works only once.',
    'MEDIUM', 'HIGH',
    ['Reset link expires after 1 hour.', 'A used link cannot be reused.', 'Response does not reveal whether the email exists.']],
  ['REQ-004', 'Product Catalog', 'Product search by keyword',
    'Users can search products by name, brand or SKU with results in under 1 second.',
    'HIGH', 'HIGH',
    ['Search is case-insensitive.', 'Empty results show suggestions.', 'P95 response time under 1 s.']],
  ['REQ-005', 'Product Catalog', 'Filter products by category, price and rating',
    'Listing pages support combinable filters; the URL reflects the active filters.',
    'MEDIUM', 'MODERATE',
    ['Filters can be combined.', 'Filter state is kept in the URL.', 'Clearing filters restores the full listing.']],
  ['REQ-006', 'Product Catalog', 'Product detail page',
    'Shows images, price, stock, description, reviews and an Add to cart button.',
    'MEDIUM', 'MODERATE',
    ['Out-of-stock products disable Add to cart.', 'Price shows in the selected currency.']],
  ['REQ-007', 'Shopping Cart', 'Add and remove items in cart',
    'Users can add products, change quantity and remove items; totals update immediately.',
    'HIGH', 'CRITICAL',
    ['Quantity is limited to available stock.', 'Subtotal updates without page reload.', 'Removing the last item shows the empty cart state.']],
  ['REQ-008', 'Shopping Cart', 'Cart persists across sessions',
    'A logged-in user\'s cart is saved server-side and restored on any device.',
    'MEDIUM', 'HIGH',
    ['Guest cart merges into the user cart on login.', 'Cart survives logout and login.']],
  ['REQ-009', 'Shopping Cart', 'Apply promo codes',
    'Valid promo codes apply a percentage or fixed discount; only one code per order.',
    'MEDIUM', 'HIGH',
    ['Expired codes are rejected with a clear message.', 'Only one code can be active.', 'Discount never makes the total negative.']],
  ['REQ-010', 'Checkout & Payments', 'Checkout with credit card',
    'Users pay by card through the payment provider; card data never touches our servers.',
    'HIGH', 'CRITICAL',
    ['3-D Secure challenge is supported.', 'Declined cards show the provider message.', 'No card number is stored or logged.']],
  ['REQ-011', 'Checkout & Payments', 'Shipping address and method selection',
    'Users choose a saved or new address and a shipping method with its price and ETA.',
    'HIGH', 'HIGH',
    ['Address is validated before payment.', 'Shipping cost is added to the total.']],
  ['REQ-012', 'Checkout & Payments', 'Order confirmation email',
    'After successful payment the user receives a confirmation email with the order summary.',
    'MEDIUM', 'MODERATE',
    ['Email is sent within 2 minutes.', 'Email contains order number, items and total.']],
  ['REQ-013', 'Order Management', 'Order history list',
    'Users see all past orders with status, date and total, newest first.',
    'MEDIUM', 'MODERATE',
    ['List is paginated by 10.', 'Each order links to its detail page.']],
  ['REQ-014', 'Order Management', 'Cancel an order before shipment',
    'Users can cancel an order while its status is PLACED or PAID; payment is refunded.',
    'HIGH', 'HIGH',
    ['Cancel is hidden once the order is shipped.', 'Refund is triggered automatically.']],
  ['REQ-015', 'Order Management', 'Return request for delivered orders',
    'Users can request a return within 30 days of delivery.',
    'LOW', 'MODERATE',
    ['Return window is 30 days.', 'A return label is emailed after approval.']],
  ['REQ-016', 'User Profile', 'Edit profile details',
    'Users can change name, phone and email; email change needs re-verification.',
    'LOW', 'LOW',
    ['Email change sends a verification link to the new address.']],
  ['REQ-017', 'User Profile', 'Manage saved addresses',
    'Users can add, edit, delete and set a default shipping address.',
    'LOW', 'MODERATE',
    ['Exactly one address can be the default.', 'Deleting the default address asks for a new default.']],
  ['REQ-018', 'User Profile', 'Notification preferences',
    'Users can opt in or out of marketing emails and SMS order updates.',
    'LOW', 'LOW',
    ['Changes take effect immediately.', 'Unsubscribe link in emails updates the preference.']],
];

// [requirement, title, description, probability 1-5, impact 1-5, mitigation]
const RISKS = [
  ['REQ-010', 'Payment provider outage blocks all checkouts',
    'If the payment provider is down, no order can be placed.', 3, 5,
    'Fallback provider + health check alert; checkout shows retry message.'],
  ['REQ-010', 'Card data leaked through logs',
    'Request logging could capture card fields if the hosted form is bypassed.', 2, 5,
    'Hosted payment fields only; log redaction test in CI.'],
  ['REQ-002', 'Credential stuffing attacks on login',
    'Bots try leaked password lists against the login endpoint.', 4, 5,
    'Rate limiting, account lockout after 5 failures, CAPTCHA after 3.'],
  ['REQ-001', 'Verification emails land in spam',
    'Users cannot finish sign-up if the email is filtered.', 3, 3,
    'SPF/DKIM configured; resend link available.'],
  ['REQ-007', 'Overselling when stock is low',
    'Two users buy the last item at the same time.', 3, 4,
    'Stock reserved at checkout start; release after 15 minutes.'],
  ['REQ-009', 'Promo code stacking abuse',
    'Users combine several codes to get items for free.', 2, 4,
    'Server-side single-code rule; total floor at 0.'],
  ['REQ-004', 'Search latency under peak load',
    'Search slows down during sales campaigns.', 3, 3,
    'Search index cache; load test before each campaign.'],
  ['REQ-014', 'Refund not triggered on cancellation',
    'Cancelled orders are not refunded, causing chargebacks.', 2, 4,
    'Reconciliation job compares cancelled orders with refunds daily.'],
  ['REQ-008', 'Cart merge loses guest items',
    'Items added as guest disappear after login.', 3, 2, null],
  ['REQ-018', 'Unsubscribe link ignored',
    'Users keep receiving marketing email after opting out (compliance risk).', 2, 3,
    'E2E test on unsubscribe link; weekly audit of suppression list.'],
];

// [tcId, requirement|null, title, priority, testType, automationStatus, preconditions, testData, [[action, expected]]]
const TEST_CASES = [
  ['TC-001', 'REQ-001', 'Register with valid email and password', 'HIGH', 'FUNCTIONAL', 'AUTOMATED',
    'Visitor is logged out.', 'email: new.user+{{timestamp}}@example.com, password: Passw0rd!',
    [['Open /register.', 'Registration form is shown.'],
     ['Enter a new email and valid password, submit.', '"Check your email" message is shown.'],
     ['Open the verification link from the email.', 'Account is verified and user is logged in.']]],
  ['TC-002', 'REQ-001', 'Register with weak password is rejected', 'MEDIUM', 'FUNCTIONAL', 'AUTOMATED',
    'Visitor is logged out.', 'password: abc',
    [['Open /register and enter a 3-character password.', 'Inline error: minimum 8 characters.'],
     ['Submit the form.', 'Form is not submitted.']]],
  ['TC-003', 'REQ-002', 'Login with valid credentials', 'HIGH', 'UI', 'AUTOMATED',
    'A verified user exists.', 'Existing demo shopper account',
    [['Open /login.', 'Login form is shown.'],
     ['Enter valid email (upper case) and password, submit.', 'User is redirected to the home page, logged in.']]],
  ['TC-004', 'REQ-002', 'Account locks after 5 failed logins', 'HIGH', 'SECURITY', 'AUTOMATED',
    'A verified user exists.', 'Wrong password x5',
    [['Submit wrong password 5 times.', 'Generic error each time.'],
     ['Submit the correct password.', 'Message: account locked, try again in 15 minutes.']]],
  ['TC-005', 'REQ-002', 'Login API returns 401 for wrong password', 'HIGH', 'API', 'AUTOMATED',
    null, 'POST /api/auth/login',
    [['POST /api/auth/login with a wrong password.', '401 with generic message; no user details.']]],
  ['TC-006', 'REQ-003', 'Reset password with valid link', 'MEDIUM', 'FUNCTIONAL', 'MANUAL',
    'User has requested a reset link.', null,
    [['Open the reset link.', 'New password form is shown.'],
     ['Set a new valid password.', 'Success message; old password no longer works.'],
     ['Open the same link again.', 'Message: link already used.']]],
  ['TC-007', 'REQ-003', 'Expired reset link is rejected', 'MEDIUM', 'FUNCTIONAL', 'MANUAL',
    'Reset link older than 1 hour.', null,
    [['Open the expired link.', 'Message: link expired, request a new one.']]],
  ['TC-008', 'REQ-004', 'Search by product name', 'HIGH', 'UI', 'AUTOMATED',
    'Catalog contains "Wireless Mouse".', 'query: wireless mouse',
    [['Type "WIRELESS mouse" in the search bar and press Enter.', 'Results include "Wireless Mouse".'],
     ['Check the result count label.', 'Count matches the number of cards shown.']]],
  ['TC-009', 'REQ-004', 'Search API P95 latency under 1 s', 'MEDIUM', 'API', 'IN_PROGRESS',
    'Staging has the full catalog.', '100 queries from search-log sample',
    [['Run the search load script against STAGING.', 'P95 under 1000 ms.']]],
  ['TC-010', 'REQ-005', 'Combine category and price filters', 'MEDIUM', 'UI', 'AUTOMATED',
    null, 'category: Electronics, price: 20-50',
    [['Open Electronics and set price 20-50.', 'Only matching products are shown.'],
     ['Reload the page.', 'Filters are still applied (from URL).']]],
  ['TC-011', 'REQ-006', 'Out-of-stock product disables Add to cart', 'MEDIUM', 'UI', 'MANUAL',
    'A product with stock 0 exists.', 'SKU-0000',
    [['Open the product detail page.', '"Out of stock" label; Add to cart is disabled.']]],
  ['TC-012', 'REQ-007', 'Add item to cart and update quantity', 'HIGH', 'UI', 'AUTOMATED',
    'User is logged in; cart is empty.', '{{TEST_PRODUCT_SKU}}',
    [['Open a product and click Add to cart.', 'Cart badge shows 1.'],
     ['Open cart and set quantity to 3.', 'Subtotal = 3 x unit price, no reload.'],
     ['Remove the item.', 'Empty cart state is shown.']]],
  ['TC-013', 'REQ-007', 'Quantity cannot exceed stock', 'HIGH', 'FUNCTIONAL', 'AUTOMATED',
    'Product has stock 2.', null,
    [['Set quantity to 5.', 'Quantity is capped at 2 with a message.']]],
  ['TC-014', 'REQ-008', 'Guest cart merges after login', 'MEDIUM', 'FUNCTIONAL', 'MANUAL',
    'User has 1 item in the saved cart.', null,
    [['As guest, add 1 different item.', 'Guest cart has 1 item.'],
     ['Log in.', 'Cart has 2 items.']]],
  ['TC-015', 'REQ-009', 'Apply valid percentage promo code', 'MEDIUM', 'FUNCTIONAL', 'AUTOMATED',
    'Promo SAVE10 is active.', 'SAVE10',
    [['Enter SAVE10 in the cart.', '10% discount line is shown; total updated.']]],
  ['TC-016', 'REQ-009', 'Expired promo code is rejected', 'MEDIUM', 'FUNCTIONAL', 'AUTOMATED',
    'Promo SUMMER23 expired.', 'SUMMER23',
    [['Enter SUMMER23.', 'Message: this code has expired.']]],
  ['TC-017', 'REQ-009', 'Second promo code replaces the first', 'LOW', 'FUNCTIONAL', 'MANUAL',
    'SAVE10 is applied.', 'FREESHIP',
    [['Apply FREESHIP.', 'Only FREESHIP is active; SAVE10 removed.']]],
  ['TC-018', 'REQ-010', 'Pay with valid card', 'HIGH', 'UI', 'AUTOMATED',
    'Cart has items; address chosen.', 'Provider test card 4242 4242 4242 4242',
    [['Enter test card details in the hosted form.', 'Card form accepts input.'],
     ['Click Pay.', 'Order confirmation page with order number.']]],
  ['TC-019', 'REQ-010', 'Declined card shows provider message', 'HIGH', 'UI', 'AUTOMATED',
    'Cart has items.', 'Provider decline test card',
    [['Pay with the decline test card.', 'Message from provider; order not created.']]],
  ['TC-020', 'REQ-010', '3-D Secure challenge completes payment', 'HIGH', 'UI', 'IN_PROGRESS',
    'Cart has items.', 'Provider 3DS test card',
    [['Pay with the 3DS card.', '3DS challenge opens.'],
     ['Approve the challenge.', 'Order is placed.']]],
  ['TC-021', 'REQ-010', 'Card number never appears in logs', 'HIGH', 'SECURITY', 'MANUAL',
    'Access to staging log search.', null,
    [['Place an order with a test card.', 'Order placed.'],
     ['Search logs for the card number.', 'No match.']]],
  ['TC-022', 'REQ-011', 'Select saved address and express shipping', 'HIGH', 'UI', 'AUTOMATED',
    'User has a saved address.', null,
    [['Choose the saved address.', 'Address shown in summary.'],
     ['Select Express shipping.', 'Shipping cost added to total.']]],
  ['TC-023', 'REQ-012', 'Order confirmation email content', 'MEDIUM', 'FUNCTIONAL', 'MANUAL',
    'An order was just placed.', null,
    [['Open the confirmation email.', 'Order number, items and total match the order.']]],
  ['TC-024', 'REQ-013', 'Order history is paginated', 'MEDIUM', 'UI', 'AUTOMATED',
    'User has 15 orders.', null,
    [['Open My orders.', '10 orders, newest first.'],
     ['Go to page 2.', 'Remaining 5 orders shown.']]],
  ['TC-025', 'REQ-014', 'Cancel a paid order', 'HIGH', 'FUNCTIONAL', 'AUTOMATED',
    'Order in PAID status.', null,
    [['Open the order and click Cancel.', 'Status becomes CANCELLED.'],
     ['Check payment provider dashboard.', 'Refund created.']]],
  ['TC-026', 'REQ-014', 'Cancel hidden for shipped orders', 'MEDIUM', 'UI', 'MANUAL',
    'Order in SHIPPED status.', null,
    [['Open the order.', 'No Cancel button.']]],
  ['TC-027', 'REQ-016', 'Change email requires verification', 'LOW', 'FUNCTIONAL', 'MANUAL',
    'User is logged in.', null,
    [['Change email in profile.', 'Message: verify your new email.'],
     ['Open link from new address.', 'Email updated.']]],
  ['TC-028', 'REQ-017', 'Set default shipping address', 'LOW', 'UI', 'MANUAL',
    'User has 2 addresses.', null,
    [['Mark the second address as default.', 'Only the second address shows "Default".']]],
  ['TC-029', null, 'Orders table has no orphaned order items', 'MEDIUM', 'DATABASE', 'AUTOMATED',
    'Read access to the staging database.', null,
    [['Run SELECT on order_items without matching order.', '0 rows.']]],
  ['TC-030', null, 'Full regression smoke: browse to order', 'HIGH', 'REGRESSION', 'AUTOMATED',
    'Staging is deployed.', null,
    [['Search, add to cart, check out with test card.', 'Order placed end-to-end without errors.']]],
];
// Not covered on purpose (shows gaps in traceability / quality gate): REQ-015, REQ-018.

// cycles: [cycleId, name, description, status, environment, daysAgo, {tcId: [status, notes, executedBy, daysAgo]}]
const CYCLES = [
  ['CYC-001', 'Sprint 12 Regression', 'Full regression before release 2.3.', 'COMPLETED', 'STAGING', 21, {
    'TC-001': ['PASSED'], 'TC-002': ['PASSED'], 'TC-003': ['PASSED'], 'TC-004': ['PASSED'],
    'TC-005': ['PASSED'], 'TC-008': ['PASSED'], 'TC-010': ['PASSED'], 'TC-012': ['PASSED'],
    'TC-013': ['FAILED', 'Quantity accepted 5 for stock 2; error only at checkout.'],
    'TC-015': ['PASSED'], 'TC-016': ['PASSED'], 'TC-018': ['PASSED'],
    'TC-019': ['PASSED'], 'TC-022': ['PASSED'], 'TC-024': ['PASSED'],
    'TC-025': ['FAILED', 'Order cancelled but no refund in provider sandbox.'],
    'TC-030': ['PASSED'],
  }],
  ['CYC-002', 'Release 2.4 Acceptance', 'Acceptance testing of release 2.4 on staging.', 'IN_PROGRESS', 'STAGING', 4, {
    'TC-001': ['PASSED'], 'TC-003': ['PASSED'], 'TC-004': ['PASSED'],
    'TC-006': ['PASSED'], 'TC-007': ['FAILED', 'Expired link still opens the reset form.'],
    'TC-008': ['PASSED'], 'TC-009': ['BLOCKED', 'Load script not ready (TC in progress).'],
    'TC-011': ['PASSED'], 'TC-012': ['PASSED'], 'TC-013': ['PASSED', 'Retest of BUG-001 OK.'],
    'TC-014': ['FAILED', 'Guest item lost after login on Safari.'],
    'TC-017': ['SKIPPED', 'Promo service not deployed in staging.'],
    'TC-018': ['PASSED'], 'TC-019': ['PASSED'],
    'TC-020': ['FAILED', '3DS popup blocked; spinner never ends.'],
    'TC-021': ['PENDING'], 'TC-022': ['PASSED'], 'TC-023': ['PENDING'],
    'TC-025': ['PASSED', 'Retest of BUG-002 OK.'], 'TC-026': ['PENDING'],
    'TC-027': ['PENDING'], 'TC-028': ['PENDING'],
  }],
  ['CYC-003', 'Release 2.4 Production Smoke', 'Post-deploy smoke on production.', 'PLANNED', 'PRODUCTION', 1, {
    'TC-003': ['PENDING'], 'TC-008': ['PENDING'], 'TC-012': ['PENDING'],
    'TC-018': ['PENDING'], 'TC-030': ['PENDING'],
  }],
];

// [bugId, title, description, steps, severity, status, tcId|null, cycleId|null, assigneeEmail|null, rootCause|null, jira|null, daysAgo]
const DEFECTS = [
  ['BUG-001', 'Cart accepts quantity above available stock',
    'Expected: quantity capped at stock (2).\n\nActual: cart accepts 5; error only appears at payment.',
    '1. Open product with stock 2.\n2. Add to cart.\n3. Set quantity 5.', 'HIGH', 'CLOSED',
    'TC-013', 'CYC-001', 'engineer@proofloop.qa', 'Stock check only in the order service, not the cart API.', 'SHOP-412', 20],
  ['BUG-002', 'No refund when a paid order is cancelled',
    'Expected: refund created in payment provider.\n\nActual: order status CANCELLED, no refund.',
    '1. Place an order and pay.\n2. Cancel it from My orders.\n3. Check provider dashboard.', 'CRITICAL', 'CLOSED',
    'TC-025', 'CYC-001', 'engineer@proofloop.qa', 'Refund event published to wrong queue name after rename.', 'SHOP-415', 20],
  ['BUG-003', 'Expired password reset link still works',
    'Expected: "link expired" message after 1 hour.\n\nActual: reset form opens and accepts a new password.',
    '1. Request reset link.\n2. Wait 61 minutes.\n3. Open link.', 'HIGH', 'IN_PROGRESS',
    'TC-007', 'CYC-002', 'engineer@proofloop.qa', 'Expiry compared in local time instead of UTC.', 'SHOP-431', 3],
  ['BUG-004', 'Guest cart items lost after login on Safari',
    'Expected: guest items merged into user cart.\n\nActual: guest items disappear (Safari 17 only).',
    '1. Safari: add item as guest.\n2. Log in.\n3. Open cart.', 'MEDIUM', 'OPEN',
    'TC-014', 'CYC-002', 'lead@proofloop.qa', null, null, 2],
  ['BUG-005', '3-D Secure popup blocked, checkout spinner never ends',
    'Expected: 3DS challenge opens.\n\nActual: browser blocks popup; spinner forever, no error.',
    '1. Pay with 3DS test card.\n2. Observe.', 'CRITICAL', 'OPEN',
    'TC-020', 'CYC-002', 'engineer@proofloop.qa', 'Challenge opened with window.open after an await (not a user gesture).', 'SHOP-433', 2],
  ['BUG-006', 'Search returns no results for SKU with lower-case letters',
    'Expected: sku-1001 finds SKU-1001.\n\nActual: no results.',
    '1. Search "sku-1001".', 'MEDIUM', 'IN_REVIEW',
    'TC-008', null, 'engineer@proofloop.qa', 'SKU field indexed as keyword without lowercase normalizer.', null, 6],
  ['BUG-007', 'Price filter ignores upper bound on page 2',
    'Expected: all products within 20-50.\n\nActual: page 2 shows products above 50.',
    '1. Filter price 20-50.\n2. Go to page 2.', 'LOW', 'OPEN',
    'TC-010', null, null, null, null, 5],
  ['BUG-008', 'Order confirmation email shows total without shipping',
    'Expected: email total = order total.\n\nActual: shipping cost missing in email total.',
    '1. Place order with Express shipping.\n2. Open confirmation email.', 'MEDIUM', 'OPEN',
    'TC-023', null, 'lead@proofloop.qa', null, null, 1],
  ['BUG-009', 'Mobile: checkout button hidden behind cookie banner',
    'Expected: Pay button visible.\n\nActual: cookie banner covers it on 375px wide screens.',
    '1. Open checkout on iPhone SE viewport.\n2. Do not accept cookies.', 'HIGH', 'OPEN',
    null, null, null, null, null, 1],
  ['BUG-010', 'Profile phone field accepts letters',
    'Expected: validation error.\n\nActual: "abc" saved as phone number.',
    '1. Profile > Phone = abc.\n2. Save.', 'LOW', 'CLOSED',
    'TC-027', null, 'engineer@proofloop.qa', null, null, 12],
];

const AUTOMATION_PROJECTS = [
  {
    name: 'Shop Web E2E',
    description: 'Playwright UI regression suite for the web shop.',
    framework: 'PLAYWRIGHT',
    repository: 'https://github.com/example/shop-e2e',
    branch: 'main',
    // [runId, status, trigger, env, daysAgo, durationMin, passed, failed, skipped, rootCause]
    runs: [
      ['RUN-001', 'PASSED', 'CI_CD', 'QA', 14, 11, 42, 0, 2, null],
      ['RUN-002', 'FAILED', 'CI_CD', 'STAGING', 12, 12, 39, 3, 2, 'Cart quantity tests fail: stock validation missing in cart API (see BUG-001).'],
      ['RUN-003', 'PASSED', 'SCHEDULED', 'STAGING', 9, 11, 44, 0, 0, null],
      ['RUN-004', 'PASSED', 'MANUAL', 'QA', 6, 10, 44, 0, 0, null],
      ['RUN-005', 'FAILED', 'CI_CD', 'STAGING', 3, 13, 41, 2, 1, '3DS checkout tests time out: challenge popup blocked by the browser (see BUG-005).'],
      ['RUN-006', 'PASSED', 'SCHEDULED', 'STAGING', 1, 11, 43, 0, 1, null],
    ],
  },
  {
    name: 'Shop API Contract',
    description: 'API contract and smoke tests for public shop endpoints.',
    framework: 'PLAYWRIGHT',
    repository: 'https://github.com/example/shop-api-tests',
    branch: 'develop',
    runs: [
      ['RUN-001', 'PASSED', 'CI_CD', 'QA', 10, 3, 28, 0, 0, null],
      ['RUN-002', 'PASSED', 'CI_CD', 'STAGING', 5, 3, 30, 0, 0, null],
      ['RUN-003', 'FAILED', 'SCHEDULED', 'STAGING', 2, 4, 27, 3, 0, 'Password reset endpoint accepts expired tokens (see BUG-003).'],
    ],
  },
];

const API_COLLECTIONS = [
  {
    name: 'Auth API',
    description: 'Login and password reset endpoints.',
    requests: [
      {
        name: 'Login - valid credentials', method: 'POST', endpoint: '{{baseUrl}}/api/{{API_VERSION}}/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'shopper@example.com', password: '{{SHOPPER_PASSWORD}}' },
        assertions: [
          { type: 'status', operator: 'equals', value: 200, dataType: 'number' },
          { type: 'body', path: '$.token', operator: 'exists' },
          { type: 'responseTime', operator: 'less_than', value: 800, dataType: 'number' },
        ],
        runs: [['PASSED', 200, 212, 6], ['PASSED', 200, 188, 2]],
      },
      {
        name: 'Login - wrong password', method: 'POST', endpoint: '{{baseUrl}}/api/{{API_VERSION}}/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { email: 'shopper@example.com', password: 'wrong-password' },
        assertions: [
          { type: 'status', operator: 'equals', value: 401, dataType: 'number' },
          { type: 'body', path: '$.message', operator: 'equals', value: 'Invalid credentials', dataType: 'string' },
        ],
        runs: [['PASSED', 401, 175, 6]],
      },
      {
        name: 'Reset password - expired token', method: 'POST', endpoint: '{{baseUrl}}/api/{{API_VERSION}}/auth/reset-password',
        headers: { 'Content-Type': 'application/json' },
        body: { token: 'expired-token-sample', newPassword: 'NewPassw0rd!' },
        assertions: [{ type: 'status', operator: 'equals', value: 400, dataType: 'number' }],
        runs: [['FAILED', 200, 240, 2, 'Assertion failed: status equals 400 (actual 200)']],
      },
    ],
  },
  {
    name: 'Catalog & Cart API',
    description: 'Product search and cart operations.',
    requests: [
      {
        name: 'Search products', method: 'GET', endpoint: '{{baseUrl}}/api/{{API_VERSION}}/products',
        queryParams: { q: 'mouse', limit: '20' },
        assertions: [
          { type: 'status', operator: 'equals', value: 200, dataType: 'number' },
          { type: 'body', path: '$.items', operator: 'exists' },
          { type: 'responseTime', operator: 'less_than', value: 1000, dataType: 'number' },
        ],
        runs: [['PASSED', 200, 320, 5], ['PASSED', 200, 295, 1]],
      },
      {
        name: 'Get product by SKU', method: 'GET', endpoint: '{{baseUrl}}/api/{{API_VERSION}}/products/{{TEST_PRODUCT_SKU}}',
        assertions: [
          { type: 'status', operator: 'equals', value: 200, dataType: 'number' },
          { type: 'body', path: '$.currency', operator: 'equals', value: '{{DEFAULT_CURRENCY}}', dataType: 'string' },
        ],
        runs: [['PASSED', 200, 140, 5]],
      },
      {
        name: 'Add item to cart', method: 'POST', endpoint: '{{baseUrl}}/api/{{API_VERSION}}/cart/items',
        headers: { 'Content-Type': 'application/json' },
        body: { sku: '{{TEST_PRODUCT_SKU}}', quantity: 1 },
        auth: { type: 'bearer', token: '{{SHOPPER_TOKEN}}' },
        assertions: [
          { type: 'status', operator: 'equals', value: 201, dataType: 'number' },
          { type: 'body', path: '$.quantity', operator: 'equals', value: 1, dataType: 'number' },
        ],
        runs: [['PASSED', 201, 260, 4]],
      },
      {
        name: 'Add item above stock', method: 'POST', endpoint: '{{baseUrl}}/api/{{API_VERSION}}/cart/items',
        headers: { 'Content-Type': 'application/json' },
        body: { sku: '{{TEST_PRODUCT_SKU}}', quantity: 999 },
        auth: { type: 'bearer', token: '{{SHOPPER_TOKEN}}' },
        assertions: [{ type: 'status', operator: 'equals', value: 422, dataType: 'number' }],
        runs: [['FAILED', 201, 255, 12, 'Assertion failed: status equals 422 (actual 201)'], ['PASSED', 422, 230, 4]],
      },
    ],
  },
];

const QUALITY_GATE = {
  requireFullCoverage: false,
  requireCriticalRiskCoverage: true,
  maxActiveCriticalDefects: 0,
  maxActiveHighDefects: 2,
};

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedUsers(prisma, org) {
  const existing = await prisma.user.findMany({ where: { email: { in: USERS.map((u) => u.email) } } });
  const missing = USERS.filter((u) => !existing.some((e) => e.email === u.email));
  let generatedPassword = null;
  if (missing.length) {
    let password = process.env.SEED_DEMO_PASSWORD;
    if (password !== undefined && password.length < 8) {
      throw new Error('SEED_DEMO_PASSWORD must be at least 8 characters.');
    }
    if (!password) {
      password = crypto.randomBytes(12).toString('base64url');
      generatedPassword = password;
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    for (const u of missing) {
      await prisma.user.create({ data: { ...u, passwordHash, organizationId: org.id } });
    }
  }
  for (const e of existing) {
    if (e.organizationId !== org.id) {
      throw new Error(`User ${e.email} exists in another organization; refusing to reuse it.`);
    }
  }
  const users = await prisma.user.findMany({ where: { organizationId: org.id } });
  return { byEmail: Object.fromEntries(users.map((u) => [u.email, u])), created: missing, generatedPassword };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organization.findMany({ where: { name: ORG_NAME } });
    if (orgs.length !== 1) throw new Error(`Expected exactly 1 organization named "${ORG_NAME}", found ${orgs.length}.`);
    const org = orgs[0];

    const { byEmail, created, generatedPassword } = await seedUsers(prisma, org);
    const admin = byEmail[ADMIN_EMAIL];
    if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} not found in "${ORG_NAME}".`);
    const userId = (email) => (email ? byEmail[email].id : null);

    let project = await prisma.project.findFirst({ where: { organizationId: org.id, name: PROJECT_NAME } });
    if (!project) {
      project = await prisma.project.create({
        data: { name: PROJECT_NAME, description: PROJECT_DESCRIPTION, organizationId: org.id },
      });
    }
    const projectId = project.id;

    // Environments + variables
    const envs = {};
    for (const e of ENVIRONMENTS) {
      const env = await prisma.projectEnvironment.upsert({
        where: { projectId_name: { projectId, name: e.name } },
        create: { name: e.name, baseUrl: e.baseUrl, projectId },
        update: { baseUrl: e.baseUrl },
      });
      envs[e.name] = env;
      for (const [key, value] of e.variables) {
        await prisma.environmentVariable.upsert({
          where: { environmentId_key: { environmentId: env.id, key } },
          create: { key, value, isSecret: false, environmentId: env.id },
          update: { value },
        });
      }
    }

    // Modules
    const modules = {};
    for (const [name, description] of MODULES) {
      modules[name] = await prisma.module.upsert({
        where: { projectId_name: { projectId, name } },
        create: { name, description, projectId },
        update: { description },
      });
    }

    // Requirements + acceptance criteria
    const reqs = {};
    for (const [reqId, moduleName, title, description, priority, businessCriticality, criteria] of REQUIREMENTS) {
      const data = { title, description, priority, businessCriticality, moduleId: modules[moduleName].id };
      const req = await prisma.requirement.upsert({
        where: { projectId_reqId: { projectId, reqId } },
        create: { ...data, reqId, projectId },
        update: data,
      });
      reqs[reqId] = req;
      await prisma.acceptanceCriteria.deleteMany({ where: { requirementId: req.id } });
      await prisma.acceptanceCriteria.createMany({
        data: criteria.map((description) => ({ description, requirementId: req.id })),
      });
    }

    // Risks (replaced per requirement; level uses the API's 5x5 banding)
    const level = (s) => (s >= 20 ? 'CRITICAL' : s >= 12 ? 'HIGH' : s >= 6 ? 'MEDIUM' : 'LOW');
    await prisma.risk.deleteMany({ where: { requirement: { projectId } } });
    for (const [reqId, title, description, probability, impact, mitigation] of RISKS) {
      const riskScore = probability * impact;
      await prisma.risk.create({
        data: { title, description, probability, impact, riskScore, level: level(riskScore), mitigation, requirementId: reqs[reqId].id },
      });
    }

    // Test cases + steps
    const tcs = {};
    for (const [tcId, reqId, title, priority, testType, automationStatus, preconditions, testData, steps] of TEST_CASES) {
      const data = {
        title, priority, testType, automationStatus, preconditions, testData,
        description: `Verifies: ${title}.`,
        requirementId: reqId ? reqs[reqId].id : null,
      };
      const tc = await prisma.testCase.upsert({
        where: { projectId_tcId: { projectId, tcId } },
        create: { ...data, tcId, projectId },
        update: data,
      });
      tcs[tcId] = tc;
      await prisma.testStep.deleteMany({ where: { testCaseId: tc.id } });
      await prisma.testStep.createMany({
        data: steps.map(([action, expectedResult], i) => ({ stepNumber: i + 1, action, expectedResult, testCaseId: tc.id })),
      });
    }

    // Test cycles + executions
    const executions = {};
    const executors = ['engineer@proofloop.qa', 'lead@proofloop.qa'];
    for (const [cycleId, name, description, status, envName, ago, results] of CYCLES) {
      const data = { name, description, status, environmentId: envs[envName].id };
      const cycle = await prisma.testCycle.upsert({
        where: { projectId_cycleId: { projectId, cycleId } },
        create: { ...data, cycleId, projectId, createdAt: daysAgo(ago) },
        update: data,
      });
      let i = 0;
      for (const [tcId, [execStatus, notes]] of Object.entries(results)) {
        const done = execStatus !== 'PENDING';
        const execData = {
          status: execStatus,
          notes: notes ?? null,
          executedById: done ? userId(executors[i % executors.length]) : null,
          executedAt: done ? daysAgo(Math.max(ago - 1 - (i % 3), 0), 9 + (i % 8)) : null,
        };
        const ex = await prisma.testExecution.upsert({
          where: { testCycleId_testCaseId: { testCycleId: cycle.id, testCaseId: tcs[tcId].id } },
          create: { ...execData, testCycleId: cycle.id, testCaseId: tcs[tcId].id },
          update: execData,
        });
        executions[`${cycleId}/${tcId}`] = ex;
        i += 1;
      }
    }

    // Defects
    for (const [bugId, title, description, stepsToReproduce, severity, status, tcId, cycleId, assignee, rootCause, jira, ago] of DEFECTS) {
      const data = {
        title, description, stepsToReproduce, severity, status,
        testCaseId: tcId ? tcs[tcId].id : null,
        testExecutionId: tcId && cycleId ? executions[`${cycleId}/${tcId}`]?.id ?? null : null,
        assigneeId: userId(assignee),
        rootCauseHypothesis: rootCause,
        jiraTicketId: jira,
      };
      await prisma.defect.upsert({
        where: { projectId_bugId: { projectId, bugId } },
        create: { ...data, bugId, projectId, reporterId: userId(ago % 2 ? 'lead@proofloop.qa' : 'engineer@proofloop.qa'), createdAt: daysAgo(ago) },
        update: data,
      });
    }

    // Automation projects + execution history
    let runCount = 0;
    for (const ap of AUTOMATION_PROJECTS) {
      const { runs, ...apData } = ap;
      const autoProject = await prisma.automationProject.upsert({
        where: { projectId_name: { projectId, name: ap.name } },
        create: { ...apData, projectId },
        update: apData,
      });
      for (const [runId, status, trigger, envName, ago, minutes, passedCount, failedCount, skippedCount, rootCause] of runs) {
        const startTime = daysAgo(ago, 2);
        const data = {
          status, trigger, passedCount, failedCount, skippedCount,
          environmentId: envs[envName].id,
          startTime,
          endTime: new Date(startTime.getTime() + minutes * 60 * 1000),
          rootCauseHypothesis: rootCause,
        };
        await prisma.automationExecution.upsert({
          where: { automationProjectId_runId: { automationProjectId: autoProject.id, runId } },
          create: { ...data, runId, automationProjectId: autoProject.id, createdAt: startTime },
          update: data,
        });
        runCount += 1;
      }
    }

    // API collections + requests + execution history
    let requestCount = 0;
    for (const col of API_COLLECTIONS) {
      const collection = await prisma.apiCollection.upsert({
        where: { projectId_name: { projectId, name: col.name } },
        create: { name: col.name, description: col.description, projectId },
        update: { description: col.description },
      });
      for (const [index, r] of col.requests.entries()) {
        const sequenceNumber = index + 1;
        const data = {
          name: r.name, method: r.method, endpoint: r.endpoint,
          headers: r.headers ?? undefined, queryParams: r.queryParams ?? undefined,
          body: r.body ?? undefined, auth: r.auth ?? { type: 'none' }, assertions: r.assertions,
        };
        const request = await prisma.apiRequest.upsert({
          where: { collectionId_sequenceNumber: { collectionId: collection.id, sequenceNumber } },
          create: { ...data, sequenceNumber, collectionId: collection.id },
          update: data,
        });
        await prisma.apiExecution.deleteMany({ where: { requestId: request.id } });
        for (const [status, statusCode, responseTime, ago, errorMessage] of r.runs) {
          await prisma.apiExecution.create({
            data: {
              status, statusCode, responseTime, errorMessage: errorMessage ?? null,
              responseBody: { seeded: true, statusCode },
              requestId: request.id, environmentId: envs.STAGING.id, createdAt: daysAgo(ago, 11),
            },
          });
        }
        requestCount += 1;
      }
    }

    // Quality gate
    await prisma.qualityGateConfig.upsert({
      where: { projectId },
      create: { ...QUALITY_GATE, projectId },
      update: QUALITY_GATE,
    });

    console.log(`Seeded "${ORG_NAME}" / "${PROJECT_NAME}" (${projectId}):`);
    console.log(
      `  ${ENVIRONMENTS.length} environments, ${MODULES.length} modules, ${REQUIREMENTS.length} requirements, ` +
      `${RISKS.length} risks, ${TEST_CASES.length} test cases, ${CYCLES.length} test cycles, ` +
      `${Object.keys(executions).length} test executions, ${DEFECTS.length} defects, ` +
      `${AUTOMATION_PROJECTS.length} automation projects (${runCount} runs), ` +
      `${API_COLLECTIONS.length} API collections (${requestCount} requests), quality gate config.`,
    );
    if (created.length) {
      console.log(`  Created users: ${created.map((u) => `${u.email} (${u.role})`).join(', ')}`);
      if (generatedPassword) {
        console.log(`  Generated password for the new users (shown once): ${generatedPassword}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
