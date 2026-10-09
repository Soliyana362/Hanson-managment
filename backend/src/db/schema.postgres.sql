CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'admin', 'coo')),
  department_id INTEGER REFERENCES departments(id),
  position VARCHAR(150),
  manager_id INTEGER REFERENCES users(id),
  phone VARCHAR(30),
  gender VARCHAR(30),
  age INTEGER,
  hire_date DATE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'inactive')),
  annual_leave_balance INTEGER DEFAULT 20,
  sick_leave_balance INTEGER DEFAULT 10,
  tin_number VARCHAR(50),
  pension_number VARCHAR(50),
  emergency_contact VARCHAR(100),
  bank_account VARCHAR(100),
  gross_salary DECIMAL(12,2),
  transport_allowance DECIMAL(12,2),
  education VARCHAR(150),
  email_verified_at TIMESTAMP,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type VARCHAR(30) NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'emergency', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_requested DECIMAL(5,1) NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by INTEGER REFERENCES users(id),
  review_notes TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  department VARCHAR(100),
  role_title VARCHAR(150),
  description TEXT,
  name_am VARCHAR(200),
  role_title_am VARCHAR(150),
  description_am TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_template_items (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES kpi_templates(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  name VARCHAR(300) NOT NULL,
  definition TEXT,
  target DECIMAL(10,2) DEFAULT 100,
  weight DECIMAL(5,2) NOT NULL,
  rating_criteria TEXT,
  name_am VARCHAR(300),
  definition_am TEXT,
  rating_criteria_am TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_submissions (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES kpi_templates(id),
  employee_id INTEGER NOT NULL REFERENCES users(id),
  reviewer_id INTEGER REFERENCES users(id),
  period_label VARCHAR(100) NOT NULL,
  period_start DATE,
  period_end DATE,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved', 'rejected')),
  total_weighted_score DECIMAL(10,2),
  overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 5),
  employee_signature_date DATE,
  reviewer_signature_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_submission_items (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES kpi_submissions(id) ON DELETE CASCADE,
  template_item_id INTEGER NOT NULL REFERENCES kpi_template_items(id),
  achievement DECIMAL(10,2),
  achievement_pct DECIMAL(10,2),
  score INTEGER CHECK (score BETWEEN 0 AND 5),
  weighted_score DECIMAL(10,2),
  comments TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  link VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vacancies (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  department VARCHAR(100),
  position VARCHAR(150),
  description TEXT,
  requirements TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'hired', 'cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL CHECK (category IN ('profile_photo', 'document')),
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vacancy_candidates (
  id SERIAL PRIMARY KEY,
  vacancy_id INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(30),
  status VARCHAR(20) DEFAULT 'applied' CHECK (status IN ('applied', 'shortlisted', 'interview', 'hired', 'rejected')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  ip_address VARCHAR(50),
  attempted_at TIMESTAMP DEFAULT NOW(),
  locked_until TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reset_token ON password_reset_tokens(token);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verification_token ON email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_kpi_sub_employee ON kpi_submissions(employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
