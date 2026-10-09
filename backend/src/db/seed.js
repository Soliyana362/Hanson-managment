require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const RATING_CRITERIA = `5: 100% - Greatly exceeds expectation
4: 96-99% - Exceeds expectation
3: 90-95% - Meets expectation
2: 84-89% - Partially meets expectation
1: 79-83% - Failed to perform`;

const KPI_TEMPLATES = [
  {
    name: 'Senior Finance Objective KPI',
    department: 'Finance',
    role_title: 'Senior Finance Officer',
    items: [
      { name: 'Monthly Reconciliation (Sales/Z report, Bank, AR & AP)', definition: 'Complete monthly reconciliation within 3 days of month end', weight: 20 },
      { name: 'Effective Audit Cycle', definition: 'Complete audit cycle per schedule without delays', weight: 15 },
      { name: 'On-time Payroll Preparation and Payment', definition: 'Prepare and pay payroll on scheduled dates', weight: 10 },
      { name: 'Tax Payments to Government Authority', definition: 'Pay all taxes monthly without penalty', weight: 15 },
      { name: 'Knowledge Transfer', definition: 'Document and transfer knowledge to team members', weight: 10 },
      { name: 'Accuracy of PV Documents', definition: 'Ensure PV documents are accurate and complete', weight: 10 },
      { name: 'Timely Submission of Reports/Assignments', definition: 'Submit all reports and assignments on time', weight: 10 },
      { name: 'Attendance', definition: 'Maintain attendance as per company policy', weight: 10 },
    ],
  },
  {
    name: 'Junior Finance Objective KPI',
    department: 'Finance',
    role_title: 'Junior Finance Officer',
    items: [
      { name: 'Monthly  Reconcilation (Salse/z report ,Bank,Aaccount receivable and payable)', definition: 'Complete monthly reconciliation within 3 days of month end', weight: 25 },
      { name: 'Document handling', definition: 'Verify that all payments and financial vouchers are recorded on legal receipts and that all documents are properly filed in the box folder without any loss', weight: 20 },
      { name: 'Accuracy of PV documents', definition: 'Keep PV documents numbered in order and verify that each outgoing legal PV document is prepared and checked', weight: 15 },
      { name: 'All taxes should pay to government Authority  Monthly  wise without any penalty', definition: 'Pay all taxes monthly without penalty', weight: 15 },
      { name: 'Timely submission of reports/Assignments', definition: 'Submit all reports and assignments on time', weight: 15 },
      { name: 'Attendance', definition: 'Maintain attendance as per company policy', weight: 10 },
    ],
  },
  {
    name: 'Showroom Head KPI',
    department: 'Sales',
    role_title: 'Showroom Head',
    items: [
      { name: 'Sales Target Achievement', definition: 'Must sell at least 10,000,000 birr (ten million) per month / be revenue for the company', weight: 35 },
      { name: 'Inventory Management', definition: 'Must check all items received for sale within one month', weight: 25 },
      { name: 'Customer Conversion Rate', definition: 'Existing customers who come at any time must increase by at least 10 per month to become house members (155 already registered within 3 months)', weight: 20 },
      { name: 'Team Training', definition: 'Must brief the sales team on the first day of every month and, if sales-related problems occur, review them within a week and report to the responsible work unit', weight: 10 },
      { name: 'Store Presentation', definition: 'The employee must be present at the work place according to the company work schedule', weight: 10 },
    ],
  },
  {
    name: 'Hanson Showroom Head KPI',
    department: 'Sales',
    role_title: 'Hanson Showroom Head',
    items: [
      { name: 'Sales Target Achievement', definition: 'Must sell at least 10,000,000 birr (ten million) per month / be revenue for the company', weight: 45 },
      { name: 'Inventory Management', definition: 'Must check all items received for sale within one month', weight: 20 },
      { name: 'Customer Conversion Rate', definition: 'Existing customers who come at any time must increase by at least 10 per month to become house members (155 already registered within 3 months)', weight: 20 },
      { name: 'Team Training', definition: 'Must brief the sales team on the first day of every month and, if sales-related problems occur, review them within a week and report to the responsible work unit', weight: 10 },
      { name: 'Store Presentation', definition: 'The employee must be present at the work place according to the company work schedule', weight: 5 },
    ],
  },
];

async function seed() {
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword || seedPassword.length < 12 || seedPassword.length > 200) {
    throw new Error('SEED_PASSWORD must be set to a value between 12 and 200 characters');
  }
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  const deptNames = ['Finance', 'Sales', 'Human Resources', 'Operations', 'Management', 'IT'];
  const deptRes = await pool.query('SELECT id, name FROM departments');
  const depts = Object.fromEntries(deptRes.rows.map((d) => [d.name, d.id]));

  for (const name of deptNames) {
    if (depts[name]) continue;
    await pool.query('INSERT INTO departments (name) VALUES ($1)', [name]);
    depts[name] = (await pool.query('SELECT id FROM departments WHERE name = $1', [name])).rows[0].id;
  }

  const users = [
    { email: 'admin@hanson.com', first_name: 'System', last_name: 'Admin', role: 'admin', department: 'Management', position: 'Administrator', gender: 'prefer_not_to_say', age: 38, tin_number: 'TIN9012345', pension_number: 'PEN9012345', emergency_contact: 'Emergency: +251-911-000001', bank_account: '10000901234', gross_salary: 12000, transport_allowance: 800, education: "Master's Degree" },
    { email: 'hr@hanson.com', first_name: 'Sara', last_name: 'Hassan', role: 'hr', department: 'Human Resources', position: 'HR Manager', gender: 'female', age: 34, tin_number: 'TIN8023456', pension_number: 'PEN8023456', emergency_contact: 'Emergency: +251-911-000002', bank_account: '10000802345', gross_salary: 9000, transport_allowance: 600, education: "Bachelor's Degree" },
    { email: 'manager@hanson.com', first_name: 'Ahmed', last_name: 'Mohamed', role: 'manager', department: 'Finance', position: 'Finance Director', gender: 'male', age: 42, tin_number: 'TIN7034567', pension_number: 'PEN7034567', emergency_contact: 'Emergency: +251-911-000003', bank_account: '10000703456', gross_salary: 10000, transport_allowance: 700, education: "Master's Degree" },
    { email: 'finance@hanson.com', first_name: 'Fatima', last_name: 'Ali', role: 'employee', department: 'Finance', position: 'Senior Finance Officer', gender: 'female', age: 29, tin_number: 'TIN6045678', pension_number: 'PEN6045678', emergency_contact: 'Emergency: +251-911-000004', bank_account: '10000604567', gross_salary: 6500, transport_allowance: 500, education: "Bachelor's Degree" },
    { email: 'sales@hanson.com', first_name: 'Muna', last_name: 'Ibrahim', role: 'employee', department: 'Sales', position: 'Showroom Head', gender: 'female', age: 31, tin_number: 'TIN5056789', pension_number: 'PEN5056789', emergency_contact: 'Emergency: +251-911-000005', bank_account: '10000505678', gross_salary: 7000, transport_allowance: 550, education: "Bachelor's Degree" },
    { email: 'employee@hanson.com', first_name: 'Omar', last_name: 'Yusuf', role: 'employee', department: 'Sales', position: 'Sales Associate', gender: 'male', age: 26, tin_number: 'TIN4067890', pension_number: 'PEN4067890', emergency_contact: 'Emergency: +251-911-000006', bank_account: '10000406789', gross_salary: 4000, transport_allowance: 350, education: 'Diploma' },
    { email: 'coo@hanson.com', first_name: 'Elias', last_name: 'Tadesse', role: 'coo', department: 'Management', position: 'Chief Operating Officer', gender: 'male', age: 45, tin_number: 'TIN3078901', pension_number: 'PEN3078901', emergency_contact: 'Emergency: +251-911-000007', bank_account: '10000307890', gross_salary: 18000, transport_allowance: 1000, education: "Master's Degree" },
  ];

  const userIds = {};
  for (const u of users) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [u.email]);

    if (existing.rows[0]) {
      // Existing accounts keep their password and verification state - seeding
      // must never reset credentials, or every re-seed would clobber whatever
      // password was rotated in and silently sign users out.
      await pool.query(
        `UPDATE users SET first_name = $2, gender = $3, age = $4, tin_number = $5, pension_number = $6,
           emergency_contact = $7, bank_account = $8, gross_salary = $9, transport_allowance = $10,
           education = $11
         WHERE email = $1`,
        [u.email, u.first_name, u.gender, u.age, u.tin_number, u.pension_number, u.emergency_contact,
          u.bank_account, u.gross_salary, u.transport_allowance, u.education]
      );
      userIds[u.email] = existing.rows[0].id;
      continue;
    }

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, department_id, position, gender, age, hire_date,
        tin_number, pension_number, emergency_contact, bank_account, gross_salary, transport_allowance, education, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '2024-01-15', $10, $11, $12, $13, $14, $15, $16, NOW())
       RETURNING id, email`,
      [u.email, passwordHash, u.first_name, u.last_name, u.role, depts[u.department], u.position,
        u.gender, u.age, u.tin_number, u.pension_number, u.emergency_contact, u.bank_account, u.gross_salary, u.transport_allowance, u.education]
    );
    userIds[u.email] = result.rows[0].id;
  }

  await pool.query(
    `UPDATE users SET manager_id = $1 WHERE email IN ('finance@hanson.com', 'employee@hanson.com')`,
    [userIds['manager@hanson.com']]
  );
  await pool.query(
    `UPDATE users SET manager_id = $1 WHERE email = 'sales@hanson.com'`,
    [userIds['manager@hanson.com']]
  );

  for (const template of KPI_TEMPLATES) {
    const existing = await pool.query('SELECT id FROM kpi_templates WHERE name = $1', [template.name]);
    let templateId = existing.rows[0]?.id;

    if (!templateId) {
      const tRes = await pool.query(
        `INSERT INTO kpi_templates (name, department, role_title, description)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [template.name, template.department, template.role_title, `KPI template for ${template.role_title}`]
      );
      templateId = tRes.rows[0].id;
    }

    const existingItems = await pool.query('SELECT id, name FROM kpi_template_items WHERE template_id = $1', [templateId]);
    const existingByName = Object.fromEntries(existingItems.rows.map((i) => [i.name, i.id]));

    for (let i = 0; i < template.items.length; i++) {
      const item = template.items[i];
      const itemId = existingByName[item.name];
      if (itemId) {
        await pool.query(
          `UPDATE kpi_template_items SET sort_order = $1, definition = $2, target = $3, weight = $4, rating_criteria = $5 WHERE id = $6`,
          [i + 1, item.definition, 100, item.weight, RATING_CRITERIA, itemId]
        );
      } else {
        await pool.query(
          `INSERT INTO kpi_template_items (template_id, sort_order, name, definition, target, weight, rating_criteria)
           VALUES ($1, $2, $3, $4, 100, $5, $6)`,
          [templateId, i + 1, item.name, item.definition, item.weight, RATING_CRITERIA]
        );
      }
    }
  }

  console.log('Seed completed. New demo accounts use SEED_PASSWORD; existing accounts keep their passwords.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
