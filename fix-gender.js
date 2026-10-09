const fs = require('fs');
const targets = [
  'C:/Users/admin/Desktop/Glorious managment/frontend/src/components/EditEmployeeModal.jsx',
  'C:/Users/admin/Desktop/Glorious managment/frontend/src/components/EditProfileModal.jsx',
  'C:/Users/admin/Desktop/Glorious managment/frontend/src/pages/Dashboard.jsx',
];
const NEW = `const GENDER_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];`;

for (const f of targets) {
  let s = fs.readFileSync(f, 'utf8');
  const r = /\bconst GENDER_OPTIONS\s*=\s*\[[\s\S]*?\];/;
  if (!r.test(s)) { console.log('NO-MATCH:', f); continue; }
  s = s.replace(r, NEW);
  fs.writeFileSync(f, s, 'utf8');
  console.log('OK:', f);
}
