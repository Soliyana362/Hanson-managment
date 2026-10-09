// Database-stored enum values stay in English; this maps them to translation keys.
export const LEAVE_TYPE_KEYS = {
  annual: 'leaveType.annual',
  sick: 'leaveType.sick',
  emergency: 'leaveType.emergency',
  unpaid: 'leaveType.unpaid',
  other: 'leaveType.other',
};

export const LEAVE_STATUS_KEYS = {
  pending: 'status.pending',
  approved: 'status.approved',
  rejected: 'status.rejected',
  cancelled: 'status.cancelled',
};

export const VACANCY_STATUS_KEYS = {
  pending: 'status.pending',
  hired: 'status.hired',
  cancelled: 'status.cancelled',
};

export const CANDIDATE_STATUS_KEYS = {
  applied: 'candidateStatus.applied',
  shortlisted: 'candidateStatus.shortlisted',
  interview: 'candidateStatus.interview',
  hired: 'candidateStatus.hired',
  rejected: 'candidateStatus.rejected',
};

export const KPI_STATUS_KEYS = {
  draft: 'status.draft',
  submitted: 'status.submitted',
  reviewed: 'status.reviewed',
  approved: 'status.approved',
  rejected: 'status.rejected',
};

export const EMPLOYMENT_STATUS_KEYS = {
  active: 'employmentStatus.active',
  on_leave: 'employmentStatus.on_leave',
  suspended: 'employmentStatus.suspended',
  terminated: 'employmentStatus.terminated',
  resigned: 'employmentStatus.resigned',
};

export const ROLE_KEYS = {
  hr: 'roles.hr',
  admin: 'roles.admin',
  manager: 'roles.manager',
  employee: 'roles.employee',
  coo: 'roles.coo',
};

export const GENDER_KEYS = {
  female: 'employees.female',
  male: 'employees.male',
  other: 'employees.other',
  prefer_not_to_say: 'employees.preferNotToSay',
};

// Education is stored as a free-text value; known values map to translation keys.
export const EDUCATION_KEYS = {
  'High School': 'education.highSchool',
  Diploma: 'education.diploma',
  Certificate: 'education.certificate',
  "Bachelor's Degree": 'education.bachelors',
  "Master's Degree": 'education.masters',
  PhD: 'education.phd',
};

export function labelFor(map, value, t) {
  if (value == null || value === '') return '—';
  const key = map[value];
  return key ? t(key) : value;
}
