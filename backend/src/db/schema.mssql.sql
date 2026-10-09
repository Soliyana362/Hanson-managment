IF OBJECT_ID('dbo.departments', 'U') IS NULL
BEGIN
  CREATE TABLE departments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL UNIQUE,
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
  CREATE TABLE users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    first_name NVARCHAR(100) NOT NULL,
    last_name NVARCHAR(100) NOT NULL,
    role NVARCHAR(20) NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'admin', 'coo')),
    department_id INT REFERENCES departments(id),
    position NVARCHAR(150),
    manager_id INT REFERENCES users(id),
    phone NVARCHAR(30),
    gender NVARCHAR(30),
    age INT,
    hire_date NVARCHAR(10),
    status NVARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'inactive')),
    annual_leave_balance INTEGER DEFAULT 20,
    sick_leave_balance INTEGER DEFAULT 10,
    email_verified_at DATETIME2,
    token_version INT NOT NULL DEFAULT 0,
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.leave_requests', 'U') IS NULL
BEGIN
  CREATE TABLE leave_requests (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type NVARCHAR(30) NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'emergency', 'other')),
    start_date NVARCHAR(10) NOT NULL,
    end_date NVARCHAR(10) NOT NULL,
    days_requested DECIMAL(5,1) NOT NULL,
    reason NVARCHAR(MAX),
    status NVARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by INT REFERENCES users(id),
    review_notes NVARCHAR(MAX),
    reviewed_at NVARCHAR(19),
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.kpi_templates', 'U') IS NULL
BEGIN
  CREATE TABLE kpi_templates (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    department NVARCHAR(100),
    role_title NVARCHAR(150),
    description NVARCHAR(MAX),
    name_am NVARCHAR(200),
    role_title_am NVARCHAR(150),
    description_am NVARCHAR(MAX),
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.kpi_template_items', 'U') IS NULL
BEGIN
  CREATE TABLE kpi_template_items (
    id INT IDENTITY(1,1) PRIMARY KEY,
    template_id INT NOT NULL REFERENCES kpi_templates(id) ON DELETE CASCADE,
    sort_order INT DEFAULT 0,
    name NVARCHAR(300) NOT NULL,
    definition NVARCHAR(MAX),
    target DECIMAL(10,2) DEFAULT 100,
    weight DECIMAL(5,2) NOT NULL,
    rating_criteria NVARCHAR(MAX),
    name_am NVARCHAR(300),
    definition_am NVARCHAR(MAX),
    rating_criteria_am NVARCHAR(MAX),
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.kpi_submissions', 'U') IS NULL
BEGIN
  CREATE TABLE kpi_submissions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    template_id INT NOT NULL REFERENCES kpi_templates(id),
    employee_id INT NOT NULL REFERENCES users(id),
    reviewer_id INT REFERENCES users(id),
    period_label NVARCHAR(100) NOT NULL,
    period_start NVARCHAR(10),
    period_end NVARCHAR(10),
    status NVARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved', 'rejected')),
    total_weighted_score DECIMAL(10,2),
    overall_rating INT CHECK (overall_rating BETWEEN 1 AND 5),
    employee_signature_date NVARCHAR(10),
    reviewer_signature_date NVARCHAR(10),
    notes NVARCHAR(MAX),
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120),
    updated_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.kpi_submission_items', 'U') IS NULL
BEGIN
  CREATE TABLE kpi_submission_items (
    id INT IDENTITY(1,1) PRIMARY KEY,
    submission_id INT NOT NULL REFERENCES kpi_submissions(id) ON DELETE CASCADE,
    template_item_id INT NOT NULL REFERENCES kpi_template_items(id),
    achievement DECIMAL(10,2),
    achievement_pct DECIMAL(10,2),
    score INT CHECK (score BETWEEN 0 AND 5),
    weighted_score DECIMAL(10,2),
    comments NVARCHAR(MAX)
  );
END
GO

IF OBJECT_ID('dbo.notifications', 'U') IS NULL
BEGIN
  CREATE TABLE notifications (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type NVARCHAR(30) NOT NULL,
    title NVARCHAR(200) NOT NULL,
    message NVARCHAR(MAX) NOT NULL,
    is_read INT NOT NULL DEFAULT 0,
    link NVARCHAR(200),
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.vacancies', 'U') IS NULL
BEGIN
  CREATE TABLE vacancies (
    id INT IDENTITY(1,1) PRIMARY KEY,
    title NVARCHAR(200) NOT NULL,
    department NVARCHAR(100),
    position NVARCHAR(150),
    description NVARCHAR(MAX),
    requirements NVARCHAR(MAX),
    status NVARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'hired', 'cancelled')),
    created_by INT REFERENCES users(id),
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120),
    updated_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.documents', 'U') IS NULL
BEGIN
  CREATE TABLE documents (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category NVARCHAR(20) NOT NULL CHECK (category IN ('profile_photo', 'document')),
    original_name NVARCHAR(255) NOT NULL,
    stored_name NVARCHAR(255) NOT NULL,
    mime_type NVARCHAR(100),
    size_bytes BIGINT,
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.vacancy_candidates', 'U') IS NULL
BEGIN
  CREATE TABLE vacancy_candidates (
    id INT IDENTITY(1,1) PRIMARY KEY,
    vacancy_id INT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
    name NVARCHAR(200) NOT NULL,
    email NVARCHAR(255),
    phone NVARCHAR(30),
    status NVARCHAR(20) DEFAULT 'applied' CHECK (status IN ('applied', 'shortlisted', 'interview', 'hired', 'rejected')),
    notes NVARCHAR(MAX),
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120),
    updated_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF OBJECT_ID('dbo.login_attempts', 'U') IS NULL
BEGIN
  CREATE TABLE login_attempts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL,
    ip_address NVARCHAR(50),
    attempted_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120),
    locked_until NVARCHAR(19)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_login_attempts_email' AND object_id = OBJECT_ID('dbo.login_attempts'))
  CREATE INDEX idx_login_attempts_email ON login_attempts(email);
GO

IF OBJECT_ID('dbo.password_reset_tokens', 'U') IS NULL
BEGIN
  CREATE TABLE password_reset_tokens (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token NVARCHAR(255) NOT NULL UNIQUE,
    expires_at NVARCHAR(19) NOT NULL,
    used INT NOT NULL DEFAULT 0,
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_reset_token' AND object_id = OBJECT_ID('dbo.password_reset_tokens'))
  CREATE INDEX idx_reset_token ON password_reset_tokens(token);
GO

IF OBJECT_ID('dbo.email_verification_tokens', 'U') IS NULL
BEGIN
  CREATE TABLE email_verification_tokens (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token NVARCHAR(255) NOT NULL UNIQUE,
    expires_at NVARCHAR(19) NOT NULL,
    used INT NOT NULL DEFAULT 0,
    created_at NVARCHAR(19) DEFAULT CONVERT(NVARCHAR(19), GETDATE(), 120)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_email_verification_token' AND object_id = OBJECT_ID('dbo.email_verification_tokens'))
  CREATE INDEX idx_email_verification_token ON email_verification_tokens(token);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_email_verification_user' AND object_id = OBJECT_ID('dbo.email_verification_tokens'))
  CREATE INDEX idx_email_verification_user ON email_verification_tokens(user_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_notif_user' AND object_id = OBJECT_ID('dbo.notifications'))
  CREATE INDEX idx_notif_user ON notifications(user_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_notif_read' AND object_id = OBJECT_ID('dbo.notifications'))
  CREATE INDEX idx_notif_read ON notifications(is_read);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_users_department' AND object_id = OBJECT_ID('dbo.users'))
  CREATE INDEX idx_users_department ON users(department_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_users_manager' AND object_id = OBJECT_ID('dbo.users'))
  CREATE INDEX idx_users_manager ON users(manager_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_leave_user' AND object_id = OBJECT_ID('dbo.leave_requests'))
  CREATE INDEX idx_leave_user ON leave_requests(user_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_leave_status' AND object_id = OBJECT_ID('dbo.leave_requests'))
  CREATE INDEX idx_leave_status ON leave_requests(status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_kpi_sub_employee' AND object_id = OBJECT_ID('dbo.kpi_submissions'))
  CREATE INDEX idx_kpi_sub_employee ON kpi_submissions(employee_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_documents_user' AND object_id = OBJECT_ID('dbo.documents'))
  CREATE INDEX idx_documents_user ON documents(user_id);
GO
