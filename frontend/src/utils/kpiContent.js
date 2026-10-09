// KPI templates and indicators are stored in English so that existing
// submissions and CSV imports keep working. Display copy comes from two places:
//
//   1. the `*_am` columns, which HR fills in for templates they import, and
//   2. the built-in translations in the locale files, which cover the four
//      templates created by the seed script.
//
// A template uses whichever of the two applies, so imported templates translate
// without a re-import while seeded templates stay editable by translators.
// Anything with neither falls back to the English stored in the database.
const TEMPLATE_KEYS = {
  'Senior Finance Objective KPI': 'seniorFinance',
  'Junior Finance Objective KPI': 'juniorFinance',
  'Showroom Head KPI': 'showroomHead',
  'Hanson Showroom Head KPI': 'hansonShowroomHead',
};

// Indicators are scoped per template because the same indicator name can carry a
// different definition in different templates (e.g. "Sales Target Achievement").
const INDICATOR_KEYS = {
  'Senior Finance Objective KPI': {
    'Monthly Reconciliation (Sales/Z report, Bank, AR & AP)': 'monthlyReconciliation',
    'Effective Audit Cycle': 'effectiveAuditCycle',
    'On-time Payroll Preparation and Payment': 'onTimePayroll',
    'Tax Payments to Government Authority': 'taxPayments',
    'Knowledge Transfer': 'knowledgeTransfer',
    'Accuracy of PV Documents': 'pvDocumentAccuracy',
    'Timely Submission of Reports/Assignments': 'timelyReportSubmission',
    Attendance: 'attendance',
  },
  'Junior Finance Objective KPI': {
    'Monthly  Reconcilation (Salse/z report ,Bank,Aaccount receivable and payable)': 'monthlyReconciliation',
    'Document handling': 'documentHandling',
    'Accuracy of PV documents': 'accuracyOfPvDocuments',
    'All taxes should pay to government Authority  Monthly  wise without any penalty': 'taxPayments',
    'Timely submission of reports/Assignments': 'timelyReportSubmission',
    Attendance: 'attendance',
  },
  'Showroom Head KPI': {
    'Sales Target Achievement': 'salesTargetAchievement',
    'Inventory Management': 'inventoryManagement',
    'Customer Conversion Rate': 'customerConversionRate',
    'Team Training': 'teamTraining',
    'Store Presentation': 'storePresentation',
  },
  'Hanson Showroom Head KPI': {
    'Sales Target Achievement': 'salesTargetAchievement',
    'Inventory Management': 'inventoryManagement',
    'Customer Conversion Rate': 'customerConversionRate',
    'Team Training': 'teamTraining',
    'Store Presentation': 'storePresentation',
    Attendance: 'attendance',
  },
};

// The seeded templates all share this rating-criteria block.
export const KPI_RATING_CRITERIA_EN =
  '5: 100% - Greatly exceeds expectation\n4: 96-99% - Exceeds expectation\n3: 90-95% - Meets expectation\n2: 84-89% - Partially meets expectation\n1: 79-83% - Failed to perform';

// Submissions copy the template name onto the row, so accept either shape.
function templateNameField(row) {
  return row?.template_name !== undefined ? 'template_name' : 'name';
}

function isAmharic(language) {
  return language !== 'en';
}

function builtinTemplatePath(row, suffix) {
  const field = templateNameField(row);
  const key = TEMPLATE_KEYS[row?.[field]];
  return key ? `kpiContent.templates.${key}.${suffix}` : null;
}

function builtinIndicatorPath(row, indicatorName, suffix) {
  const field = templateNameField(row);
  const templateKey = TEMPLATE_KEYS[row?.[field]];
  if (!templateKey) return null;
  const indicatorKey = INDICATOR_KEYS[row?.[field]]?.[indicatorName];
  if (!indicatorKey) return null;
  return `kpiContent.templates.${templateKey}.indicators.${indicatorKey}.${suffix}`;
}

export function templateName(row, t, language) {
  const field = templateNameField(row);
  const english = row?.[field];
  if (!english) return '—';
  if (isAmharic(language) && row.name_am) return row.name_am;
  const path = builtinTemplatePath(row, 'name');
  return path ? t(path) : english;
}

export function templateRoleTitle(row, t, language) {
  const english = row?.role_title;
  if (!english) return null;
  if (isAmharic(language) && row.role_title_am) return row.role_title_am;
  const path = builtinTemplatePath(row, 'roleTitle');
  return path ? t(path) : english;
}

export function indicatorName(row, indicator, t, language) {
  const english = indicator?.name;
  if (!english) return '';
  if (isAmharic(language) && indicator.name_am) return indicator.name_am;
  const path = builtinIndicatorPath(row, english, 'name');
  return path ? t(path) : english;
}

export function indicatorDefinition(row, indicator, t, language) {
  const english = indicator?.definition;
  if (isAmharic(language) && indicator?.definition_am) return indicator.definition_am;
  const path = builtinIndicatorPath(row, indicator?.name, 'definition');
  return path ? t(path) : english;
}

export function ratingCriteria(value, t) {
  return value === KPI_RATING_CRITERIA_EN ? t('kpiContent.ratingCriteria') : value;
}

// A template may publish its own rating legend alongside the shared criteria.
// This is display copy only: scoreFromAchievement() on the server and calcScore()
// here stay on the shared bands, so a custom legend never changes a score.
export function templateRatingScale(row, t) {
  const path = builtinTemplatePath(row, 'ratingScale');
  return path ? t(path) : null;
}

// The same legend split into individual rules so a table cell can show the one
// line that describes its own rating. Rules are written highest score first, so
// index 0 is the 5-point band.
export function templateRatingScaleRules(row, t) {
  const text = templateRatingScale(row, t);
  if (typeof text !== 'string' || !text) return null;
  const rules = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return rules.length ? rules : null;
}

// The indicator each legend belongs to, keyed by `template::indicator`. The
// value names the locale suffix holding the rules plus the table cell it is
// printed in, so a template can give more than one indicator its own scale.
// `hideScore` additionally drops the score fraction from the score column, which
// is opt-in per indicator because having a legend does not imply it.
const RATING_SCALE_HOSTS = {
  'Senior Finance Objective KPI::Monthly Reconciliation (Sales/Z report, Bank, AR & AP)': {
    suffix: 'ratingScale',
    cell: 'rating',
    hideScore: true,
  },
  'Senior Finance Objective KPI::Effective Audit Cycle': {
    suffix: 'pvRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Senior Finance Objective KPI::Accuracy of PV Documents': {
    suffix: 'pvLegalRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Senior Finance Objective KPI::Attendance': {
    suffix: 'attendanceRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Senior Finance Objective KPI::Timely Submission of Reports/Assignments': {
    suffix: 'timelyReportRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Senior Finance Objective KPI::Tax Payments to Government Authority': {
    suffix: 'taxPaymentRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Senior Finance Objective KPI::Knowledge Transfer': {
    suffix: 'knowledgeTransferRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Senior Finance Objective KPI::On-time Payroll Preparation and Payment': {
    suffix: 'payrollRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Junior Finance Objective KPI::Monthly  Reconcilation (Salse/z report ,Bank,Aaccount receivable and payable)': {
    suffix: 'ratingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Junior Finance Objective KPI::Document handling': {
    suffix: 'documentHandlingRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Junior Finance Objective KPI::Accuracy of PV documents': {
    suffix: 'accuracyOfPvRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Junior Finance Objective KPI::All taxes should pay to government Authority  Monthly  wise without any penalty': {
    suffix: 'taxPaymentsRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Junior Finance Objective KPI::Attendance': {
    suffix: 'attendanceRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Junior Finance Objective KPI::Timely submission of reports/Assignments': {
    suffix: 'timelyReportRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Hanson Showroom Head KPI::Sales Target Achievement': {
    suffix: 'salesTargetRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Hanson Showroom Head KPI::Inventory Management': {
    suffix: 'inventoryRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Hanson Showroom Head KPI::Customer Conversion Rate': {
    suffix: 'conversionRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Hanson Showroom Head KPI::Team Training': {
    suffix: 'trainingRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Hanson Showroom Head KPI::Store Presentation': {
    suffix: 'storePresentationRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Showroom Head KPI::Sales Target Achievement': {
    suffix: 'salesTargetRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Showroom Head KPI::Inventory Management': {
    suffix: 'inventoryRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Showroom Head KPI::Customer Conversion Rate': {
    suffix: 'conversionRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Showroom Head KPI::Team Training': {
    suffix: 'trainingRatingScale',
    cell: 'rating',
    hideScore: false,
  },
  'Showroom Head KPI::Store Presentation': {
    suffix: 'storePresentationRatingScale',
    cell: 'rating',
    hideScore: false,
  },
};

function ratingScaleHostFor(row, indicator) {
  const field = templateNameField(row);
  const host = RATING_SCALE_HOSTS[`${row?.[field]}::${indicator?.name}`];
  if (!host) return null;
  const templateKey = TEMPLATE_KEYS[row?.[field]];
  if (!templateKey) return null;
  return {
    path: `kpiContent.templates.${templateKey}.${host.suffix}`,
    cell: host.cell,
    hideScore: host.hideScore === true,
  };
}

export function isRatingScaleHost(row, indicator) {
  return ratingScaleHostFor(row, indicator) !== null;
}

// Whether this indicator's score column should show only the achievement
// percentage, without the score fraction beside it.
export function ratingScaleHidesScore(row, indicator) {
  return ratingScaleHostFor(row, indicator)?.hideScore === true;
}

// Returns the rules for this indicator when they belong in `cell`, else null.
export function indicatorRatingScaleRules(row, indicator, t, cell) {
  const host = ratingScaleHostFor(row, indicator);
  if (!host || host.cell !== cell) return null;
  const text = t(host.path);
  if (typeof text !== 'string' || !text) return null;
  const rules = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return rules.length ? rules : null;
}
