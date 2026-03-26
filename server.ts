import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';

// Initialize SQLite database
const db = new Database('database.sqlite');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY, name TEXT, creditCode TEXT, industry TEXT, contact TEXT, phone TEXT
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT, client TEXT, dept TEXT, manager TEXT, status TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, project_id TEXT, title TEXT, demand INTEGER, location TEXT, skills TEXT, level TEXT, salary TEXT, recruiters TEXT
  );
  CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY, name TEXT, job TEXT, matchScore INTEGER, status TEXT, uploadTime TEXT
  );
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY, name TEXT, job TEXT, resumeScore INTEGER, interviewScore INTEGER, aiEval TEXT, status TEXT
  );
  CREATE TABLE IF NOT EXISTS depts (
    id TEXT PRIMARY KEY, name TEXT, level INTEGER, manager TEXT, count INTEGER
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, username TEXT, dept TEXT, role TEXT, status TEXT
  );
  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY, name TEXT, desc TEXT, users INTEGER
  );
  CREATE TABLE IF NOT EXISTS menus (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, icon TEXT, path TEXT, level INTEGER
  );
`);

// Seed initial mock data if the database is empty
const seedData = () => {
  const clientCount = db.prepare('SELECT COUNT(*) as count FROM clients').get() as { count: number };
  if (clientCount.count > 0) return; // Data already seeded

  const insertClient = db.prepare('INSERT INTO clients VALUES (?, ?, ?, ?, ?, ?)');
  insertClient.run('C001', '北京字节跳动科技有限公司', '91110108592343245G', '互联网', '张总', '13800000001');
  insertClient.run('C002', '阿里巴巴（中国）网络技术有限公司', '91330100719167708Y', '电子商务', '王总', '13800000002');

  const insertProject = db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)');
  insertProject.run('P001', '2026春季核心研发招聘', '北京字节跳动科技有限公司', '华北交付中心', '李交付', '进行中');

  const insertJob = db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertJob.run('J001', 'P001', '高级前端工程师', 5, '北京', 'React, TypeScript', '高级', '30k-50k', JSON.stringify(['赵招聘', '钱招聘']));
  insertJob.run('J002', 'P001', 'Java架构师', 2, '北京', 'Java, Spring Cloud', '专家', '50k-80k', JSON.stringify(['钱招聘']));

  const insertResume = db.prepare('INSERT INTO resumes VALUES (?, ?, ?, ?, ?, ?)');
  insertResume.run('R001', '陈大文', '高级前端工程师', 95, 'AI分析完成', '2026-03-25 10:00');
  insertResume.run('R002', '林小明', '高级前端工程师', 78, 'AI分析完成', '2026-03-25 11:30');
  insertResume.run('R003', '王五', 'Java架构师', 45, '不匹配', '2026-03-25 14:20');

  const insertApp = db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertApp.run('A001', '陈大文', '高级前端工程师', 95, 88, '技术扎实，沟通顺畅，强烈建议推进。', '待初试');
  insertApp.run('A002', '林小明', '高级前端工程师', 78, 65, '基础尚可，但高级架构经验不足。', '已淘汰');

  const insertDept = db.prepare('INSERT INTO depts VALUES (?, ?, ?, ?, ?)');
  insertDept.run('D1', '集团总部', 0, '张总', 120);
  insertDept.run('D2', '华北交付中心', 1, '李总', 45);
  insertDept.run('D3', '研发一部', 2, '王经理', 20);
  insertDept.run('D4', '华南交付中心', 1, '赵总', 38);

  const insertUser = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)');
  insertUser.run('U1', '系统管理员', 'admin', '集团总部', '平台管理员', '正常');
  insertUser.run('U2', '李交付', 'li.jiaofu', '华北交付中心', '交付经理', '正常');
  insertUser.run('U3', '赵招聘', 'zhao.zhaopin', '研发一部', '招聘人员', '正常');

  const insertRole = db.prepare('INSERT INTO roles VALUES (?, ?, ?, ?)');
  insertRole.run('R1', '平台管理员', '拥有系统所有模块的最高权限', 1);
  insertRole.run('R2', '交付经理', '负责客户维护与招聘项目管理', 12);
  insertRole.run('R3', '招聘人员', '负责岗位发布、简历筛查与面试跟进', 45);

  const insertMenu = db.prepare('INSERT INTO menus VALUES (?, ?, ?, ?, ?, ?)');
  insertMenu.run('M1', '项目管理', '目录', 'Briefcase', '/projects', 0);
  insertMenu.run('M1-1', '客户管理', '菜单', 'Building2', '/projects/clients', 1);
  insertMenu.run('M1-2', '招聘项目', '菜单', 'Briefcase', '/projects/list', 1);
  insertMenu.run('M2', '招聘管理', '目录', 'Users', '/recruitment', 0);
  insertMenu.run('M2-1', '岗位查询', '菜单', 'Search', '/recruitment/jobs', 1);
  insertMenu.run('M2-2', '简历筛查 (AI)', '菜单', 'FileText', '/recruitment/resume', 1);
  insertMenu.run('M2-3', '应聘管理', '菜单', 'UserCheck', '/recruitment/applications', 1);
  insertMenu.run('M3', '系统管理', '目录', 'Settings', '/system', 0);
};

seedData();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API Routes ---

  app.get('/api/clients', (req, res) => {
    res.json(db.prepare('SELECT * FROM clients').all());
  });

  app.get('/api/projects', (req, res) => {
    const projects = db.prepare('SELECT * FROM projects').all();
    const jobs = db.prepare('SELECT * FROM jobs').all();
    
    // Nest jobs inside projects
    const result = projects.map((p: any) => ({
      ...p,
      jobs: jobs.filter((j: any) => j.project_id === p.id).map((j: any) => ({
        ...j,
        recruiters: JSON.parse(j.recruiters)
      }))
    }));
    res.json(result);
  });

  app.get('/api/resumes', (req, res) => {
    res.json(db.prepare('SELECT * FROM resumes').all());
  });

  app.get('/api/applications', (req, res) => {
    res.json(db.prepare('SELECT * FROM applications').all());
  });

  app.get('/api/depts', (req, res) => {
    res.json(db.prepare('SELECT * FROM depts').all());
  });

  app.get('/api/users', (req, res) => {
    res.json(db.prepare('SELECT * FROM users').all());
  });

  app.get('/api/roles', (req, res) => {
    res.json(db.prepare('SELECT * FROM roles').all());
  });

  app.get('/api/menus', (req, res) => {
    res.json(db.prepare('SELECT * FROM menus').all());
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
