const express = require('express');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    const [profileRes, leaveRes, pendingLeaveRes, kpiRes, kpiHistoryRes] = await Promise.all([
      pool.query(
        `SELECT u.first_name, u.last_name, u.status, CAST(u.annual_leave_balance AS INTEGER) AS annual_leave_balance, CAST(u.sick_leave_balance AS INTEGER) AS sick_leave_balance,
                d.name AS department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE status = 'approved') AS approved
         FROM leave_requests WHERE user_id = $1`,
        [userId]
      ),
      role === 'manager'
        ? pool.query(`SELECT COUNT(*) AS count FROM leave_requests WHERE status = 'pending' AND user_id IN (SELECT id FROM users WHERE manager_id = $1)`, [userId])
        : role !== 'employee'
        ? pool.query(`SELECT COUNT(*) AS count FROM leave_requests WHERE status = 'pending'`)
        : Promise.resolve({ rows: [{ count: 0 }] }),
      pool.query(
        `SELECT COUNT(*) AS count FROM kpi_submissions
         WHERE employee_id = $1 AND status IN ('draft', 'submitted')`,
        [userId]
      ),
      pool.query(
        `SELECT ks.period_label, ks.total_weighted_score, ks.overall_rating, ks.status, ks.created_at
         FROM kpi_submissions ks
         WHERE ks.employee_id = $1 AND ks.status IN ('submitted', 'reviewed', 'approved')
         ORDER BY ks.created_at DESC`,
        [userId]
      ),
    ]);

    let teamStats = null;
    if (['hr', 'admin', 'manager'].includes(role)) {
      const isManager = role === 'manager';
      const managerParam = isManager ? [userId] : [];
      const roleFilter = isManager ? `WHERE u.manager_id = $1 AND u.role = 'employee'` : `WHERE u.role = 'employee'`;
      const [teamRes, statusRes, deptRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS total_employees,
                  SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) AS active,
                  SUM(CASE WHEN u.status = 'on_leave' THEN 1 ELSE 0 END) AS on_leave
           FROM users u ${roleFilter}`,
          managerParam
        ),
        pool.query(
          `SELECT u.status, COUNT(*) AS count
           FROM users u ${roleFilter}
           GROUP BY u.status`,
          managerParam
        ),
pool.query(
          `SELECT d.name AS department_name, COUNT(u.id) AS count
           FROM departments d
           LEFT JOIN users u ON u.department_id = d.id AND u.role = 'employee' ${isManager ? `WHERE u.manager_id = $1` : ''}
           GROUP BY d.name ORDER BY d.name`,
          isManager ? [userId] : undefined
        ),
      ]);
      teamStats = {
        ...teamRes.rows[0],
        by_status: statusRes.rows,
        by_department: deptRes.rows,
      };
    }

    res.json({
      profile: profileRes.rows[0],
      leave: leaveRes.rows[0],
      pendingReviews: parseInt(pendingLeaveRes.rows[0].count, 10),
      openKpis: parseInt(kpiRes.rows[0].count, 10),
      kpiHistory: kpiHistoryRes.rows,
      team: teamStats,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;
