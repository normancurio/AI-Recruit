import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, Briefcase, Users, FileText, UserCheck, 
  Settings, Network, UserCog, Shield, Menu as MenuIcon,
  Search, Plus, UploadCloud, BrainCircuit, ChevronDown,
  ChevronRight, MoreHorizontal, CheckCircle2, XCircle,
  LogOut, Bell, LayoutDashboard
} from 'lucide-react';

// --- Types ---
type Role = 'admin' | 'delivery_manager' | 'recruiter';

export interface Client { id: string; name: string; creditCode: string; industry: string; contact: string; phone: string; }
export interface Job { id: string; project_id: string; title: string; demand: number; location: string; skills: string; level: string; salary: string; recruiters: string[]; }
export interface Project { id: string; name: string; client: string; dept: string; manager: string; status: string; jobs: Job[]; }
export interface Resume { id: string; name: string; job: string; matchScore: number; status: string; uploadTime: string; }
export interface Application { id: string; name: string; job: string; resumeScore: number; interviewScore: number; aiEval: string; status: string; }
export interface Dept { id: string; name: string; level: number; manager: string; count: number; }
export interface User { id: string; name: string; username: string; dept: string; role: string; status: string; }
export interface SysRole { id: string; name: string; desc: string; users: number; }
export interface Menu { id: string; name: string; type: string; icon: string; path: string; level: number; }

// --- Components ---

export default function App() {
  const [currentRole, setCurrentRole] = useState<Role>('delivery_manager');
  const [activeMenu, setActiveMenu] = useState('clients');
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['projects', 'recruitment', 'system']);

  const toggleMenu = (menu: string) => {
    setExpandedMenus(prev => prev.includes(menu) ? prev.filter(m => m !== menu) : [...prev, menu]);
  };

  type NavChild = {
    id: string;
    title: string;
    roles?: string[];
    icon?: React.ReactNode;
  };

  type NavItem = {
    id: string;
    title: string;
    icon: React.ReactNode;
    roles: string[];
    children?: NavChild[];
  };

  // Navigation Config based on Role
  const navConfig: NavItem[] = [
    {
      id: 'projects',
      title: '项目管理',
      icon: <Briefcase className="w-5 h-5" />,
      roles: ['admin', 'delivery_manager', 'recruiter'],
      children: [
        { id: 'clients', title: '客户管理', roles: ['admin', 'delivery_manager'], icon: <Building2 className="w-4 h-4" /> },
        { id: 'project-list', title: '招聘项目', roles: ['admin', 'delivery_manager', 'recruiter'], icon: <Briefcase className="w-4 h-4" /> }
      ]
    },
    {
      id: 'recruitment',
      title: '招聘管理',
      icon: <Users className="w-5 h-5" />,
      roles: ['admin', 'recruiter'],
      children: [
        { id: 'job-query', title: '岗位查询', roles: ['admin', 'recruiter'] },
        { id: 'resume-screening', title: '简历筛查 (AI)', roles: ['admin', 'recruiter'] },
        { id: 'application-mgmt', title: '应聘管理', roles: ['admin', 'recruiter'] }
      ]
    },
    {
      id: 'system',
      title: '系统管理',
      icon: <Settings className="w-5 h-5" />,
      roles: ['admin'],
      children: [
        { id: 'sys-dept', title: '部门管理', icon: <Network className="w-4 h-4" /> },
        { id: 'sys-user', title: '用户管理', icon: <UserCog className="w-4 h-4" /> },
        { id: 'sys-role', title: '角色管理', icon: <Shield className="w-4 h-4" /> },
        { id: 'sys-menu', title: '菜单管理', icon: <MenuIcon className="w-4 h-4" /> }
      ]
    }
  ];

  const renderContent = () => {
    switch (activeMenu) {
      case 'clients': return <ClientManagementView />;
      case 'project-list': return <ProjectManagementView role={currentRole} />;
      case 'job-query': return <JobQueryView />;
      case 'resume-screening': return <ResumeScreeningView />;
      case 'application-mgmt': return <ApplicationManagementView />;
      case 'sys-dept': return <SystemDeptView />;
      case 'sys-user': return <SystemUserView />;
      case 'sys-role': return <SystemRoleView />;
      case 'sys-menu': return <SystemMenuView />;
      default: return <div className="p-8 text-slate-500">模块开发中...</div>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-20">
        <div className="h-16 flex items-center px-6 border-b border-slate-800 bg-slate-950">
          <BrainCircuit className="w-6 h-6 text-indigo-400 mr-3" />
          <span className="text-lg font-bold text-white tracking-wide">AI 招聘系统</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          {navConfig.filter(nav => nav.roles.includes(currentRole)).map(nav => (
            <div key={nav.id} className="mb-1">
              {nav.children ? (
                <>
                  <button 
                    onClick={() => toggleMenu(nav.id)}
                    className="w-full flex items-center justify-between px-6 py-3 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {nav.icon}
                      <span className="font-medium">{nav.title}</span>
                    </div>
                    <ChevronDown className={`w-4 h-4 transition-transform ${expandedMenus.includes(nav.id) ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {expandedMenus.includes(nav.id) && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-slate-900/50"
                      >
                        {nav.children.filter(child => !child.roles || child.roles.includes(currentRole)).map(child => (
                          <button
                            key={child.id}
                            onClick={() => setActiveMenu(child.id)}
                            className={`w-full flex items-center gap-3 pl-14 pr-6 py-2.5 text-sm transition-colors ${
                              activeMenu === child.id ? 'text-indigo-400 bg-indigo-500/10 font-medium' : 'hover:text-white hover:bg-slate-800'
                            }`}
                          >
                            {child.icon || <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />}
                            {child.title}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <button
                  onClick={() => setActiveMenu(nav.id)}
                  className={`w-full flex items-center gap-3 px-6 py-3 transition-colors ${
                    activeMenu === nav.id ? 'text-indigo-400 bg-indigo-500/10 border-r-2 border-indigo-400' : 'hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {nav.icon}
                  <span className="font-medium">{nav.title}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm z-10">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-slate-800">
              {navConfig.flatMap(n => n.children ? [n, ...n.children] : [n]).find(n => n.id === activeMenu)?.title || '工作台'}
            </h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">当前视角模拟:</span>
              <select 
                value={currentRole}
                onChange={(e) => {
                  setCurrentRole(e.target.value as Role);
                  setActiveMenu(e.target.value === 'recruiter' ? 'job-query' : 'clients');
                }}
                className="bg-slate-100 border-none text-sm font-medium rounded-md py-1.5 px-3 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="admin">平台管理员 (全权限)</option>
                <option value="delivery_manager">交付经理 (客户/项目)</option>
                <option value="recruiter">招聘人员 (岗位/简历/应聘)</option>
              </select>
            </div>
            <div className="w-px h-6 bg-slate-200"></div>
            <button className="text-slate-400 hover:text-slate-600 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold">
                {currentRole === 'admin' ? 'A' : currentRole === 'delivery_manager' ? 'D' : 'R'}
              </div>
              <span className="text-sm font-medium text-slate-700">
                {currentRole === 'admin' ? '管理员' : currentRole === 'delivery_manager' ? '李交付' : '赵招聘'}
              </span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-8 bg-slate-50/50">
          <motion.div
            key={activeMenu}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="max-w-7xl mx-auto"
          >
            {renderContent()}
          </motion.div>
        </div>
      </main>
    </div>
  );
}

// --- View Components ---

function ClientManagementView() {
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    fetch('/api/clients').then(res => res.json()).then(setClients);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex gap-4">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索客户名称或信用代码..." className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> 新增客户
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">企业名称</th>
              <th className="px-6 py-4 font-medium">统一社会信用代码 (主键)</th>
              <th className="px-6 py-4 font-medium">所属行业</th>
              <th className="px-6 py-4 font-medium">联系人</th>
              <th className="px-6 py-4 font-medium">联系电话</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map(client => (
              <tr key={client.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-900">{client.name}</td>
                <td className="px-6 py-4 font-mono text-slate-500">{client.creditCode}</td>
                <td className="px-6 py-4 text-slate-600">{client.industry}</td>
                <td className="px-6 py-4 text-slate-600">{client.contact}</td>
                <td className="px-6 py-4 text-slate-600">{client.phone}</td>
                <td className="px-6 py-4 text-right">
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectManagementView({ role }: { role: Role }) {
  const [expandedProject, setExpandedProject] = useState<string | null>('P001');
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch('/api/projects').then(res => res.json()).then(setProjects);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-slate-500">
          {role === 'delivery_manager' ? '您只能看到本部门（华北交付中心）的项目信息。' : '全部项目列表。'}
        </p>
        {(role === 'admin' || role === 'delivery_manager') && (
          <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> 新建招聘项目
          </button>
        )}
      </div>

      <div className="space-y-4">
        {projects.map(project => (
          <div key={project.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Project Header */}
            <div 
              className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}
            >
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${expandedProject === project.id ? 'rotate-90' : ''}`} />
                  <h3 className="text-lg font-bold text-slate-900">{project.name}</h3>
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-md">{project.status}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span>客户: {project.client}</span>
                  <span>部门: {project.dept}</span>
                  <span>负责人: {project.manager}</span>
                </div>
              </div>
              {(role === 'admin' || role === 'delivery_manager') && (
                <button className="text-sm text-indigo-600 font-medium hover:underline" onClick={e => e.stopPropagation()}>添加岗位</button>
              )}
            </div>

            {/* Jobs List (Expanded) */}
            <AnimatePresence>
              {expandedProject === project.id && (
                <motion.div 
                  initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                  className="overflow-hidden border-t border-slate-100 bg-slate-50/50"
                >
                  <div className="p-6">
                    <h4 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                      <Briefcase className="w-4 h-4" /> 包含岗位 ({project.jobs.length})
                    </h4>
                    <div className="grid grid-cols-1 gap-4">
                      {project.jobs.map(job => (
                        <div key={job.id} className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-bold text-slate-900">{job.title}</span>
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">{job.level}</span>
                              <span className="text-orange-600 font-medium text-sm">{job.salary}</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-slate-500">
                              <span>需求量: <strong className="text-slate-700">{job.demand}人</strong></span>
                              <span>地点: {job.location}</span>
                              <span>技能: {job.skills}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-slate-500 mb-1">可见招聘人员权限</div>
                            <div className="flex gap-1 justify-end">
                              {job.recruiters.map(r => (
                                <span key={r} className="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-md border border-indigo-100">{r}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobQueryView() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [projectName, setProjectName] = useState('');

  useEffect(() => {
    fetch('/api/projects').then(res => res.json()).then((data: Project[]) => {
      if (data.length > 0) {
        setJobs(data[0].jobs);
        setProjectName(data[0].name);
      }
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
        <BrainCircuit className="w-5 h-5 text-indigo-600 mt-0.5" />
        <div>
          <h4 className="font-bold text-indigo-900">招聘人员视图</h4>
          <p className="text-sm text-indigo-700 mt-1">您只能查询到交付经理分配给您的岗位。点击岗位可直接进入简历筛查或应聘管理。</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {jobs.map(job => (
          <div key={job.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow cursor-pointer group">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{job.title}</h3>
                <p className="text-sm text-slate-500 mt-1">{projectName}</p>
              </div>
              <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-md">需求 {job.demand} 人</span>
            </div>
            <div className="space-y-2 text-sm text-slate-600 mb-6">
              <div className="flex justify-between"><span>工作地点</span><span className="font-medium text-slate-900">{job.location}</span></div>
              <div className="flex justify-between"><span>薪酬范围</span><span className="font-medium text-orange-600">{job.salary}</span></div>
              <div className="flex justify-between"><span>级别要求</span><span className="font-medium text-slate-900">{job.level}</span></div>
            </div>
            <div className="flex gap-3">
              <button className="flex-1 bg-slate-50 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-100 transition-colors border border-slate-200">
                查看JD
              </button>
              <button className="flex-1 bg-indigo-50 text-indigo-700 py-2 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors border border-indigo-100">
                去筛简历
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResumeScreeningView() {
  const [resumes, setResumes] = useState<Resume[]>([]);

  useEffect(() => {
    fetch('/api/resumes').then(res => res.json()).then(setResumes);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex gap-6">
        {/* Upload Area */}
        <div className="w-1/3">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-full flex flex-col">
            <h3 className="font-bold text-slate-900 mb-4">上传简历进行 AI 筛查</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">目标匹配岗位</label>
              <select className="w-full border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none text-sm">
                <option>高级前端工程师 (J001)</option>
                <option>Java架构师 (J002)</option>
              </select>
            </div>
            <div className="flex-1 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center p-8 text-center hover:bg-slate-50 hover:border-indigo-400 transition-colors cursor-pointer group">
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-8 h-8 text-indigo-500" />
              </div>
              <p className="font-medium text-slate-700 mb-1">点击或拖拽简历文件到此处</p>
              <p className="text-xs text-slate-500">支持 PDF, Word, TXT 格式。AI 将自动解析并打分。</p>
            </div>
          </div>
        </div>

        {/* Results Area */}
        <div className="w-2/3">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">AI 筛查结果</h3>
              <span className="text-sm text-slate-500">共解析 {resumes.length} 份简历</span>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {resumes.map(resume => (
                <div key={resume.id} className="border border-slate-200 rounded-lg p-4 flex items-center gap-6 hover:border-indigo-300 transition-colors">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <FileText className="w-6 h-6 text-slate-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h4 className="font-bold text-slate-900 text-lg">{resume.name}</h4>
                      <span className="text-xs text-slate-500">匹配岗位: {resume.job}</span>
                    </div>
                    <div className="text-sm text-slate-500">上传时间: {resume.uploadTime}</div>
                  </div>
                  <div className="w-48">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600 font-medium flex items-center gap-1">
                        <BrainCircuit className="w-4 h-4 text-indigo-500" /> AI 匹配度
                      </span>
                      <span className={`font-bold ${resume.matchScore >= 80 ? 'text-emerald-600' : resume.matchScore >= 60 ? 'text-orange-500' : 'text-red-500'}`}>
                        {resume.matchScore}分
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${resume.matchScore >= 80 ? 'bg-emerald-500' : resume.matchScore >= 60 ? 'bg-orange-400' : 'bg-red-400'}`}
                        style={{ width: `${resume.matchScore}%` }}
                      ></div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-sm font-medium rounded hover:bg-indigo-100">查看报告</button>
                    {resume.matchScore >= 60 && (
                      <button className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-sm font-medium rounded hover:bg-emerald-100">发起面试</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApplicationManagementView() {
  const [applications, setApplications] = useState<Application[]>([]);

  useEffect(() => {
    fetch('/api/applications').then(res => res.json()).then(setApplications);
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-900">应聘人员及 AI 面试结果</h3>
          <div className="flex gap-3">
            <select className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none">
              <option>全部岗位</option>
              <option>高级前端工程师</option>
            </select>
            <select className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none">
              <option>全部状态</option>
              <option>待初试</option>
              <option>已淘汰</option>
            </select>
          </div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-white border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">候选人</th>
              <th className="px-6 py-4 font-medium">应聘岗位</th>
              <th className="px-6 py-4 font-medium">AI 简历匹配度</th>
              <th className="px-6 py-4 font-medium">AI 面试评分</th>
              <th className="px-6 py-4 font-medium w-1/3">AI 综合评价</th>
              <th className="px-6 py-4 font-medium">当前状态</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {applications.map(app => (
              <tr key={app.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-bold text-slate-900">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                      {app.name[0]}
                    </div>
                    {app.name}
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600">{app.job}</td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">
                    <FileText className="w-3.5 h-3.5" /> {app.resumeScore}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium ${app.interviewScore >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                    <BrainCircuit className="w-3.5 h-3.5" /> {app.interviewScore}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-500 text-xs leading-relaxed">{app.aiEval}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${app.status === '待初试' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {app.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right space-x-3">
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">详情</button>
                  {app.status !== '已淘汰' && (
                    <>
                      <button className="text-emerald-600 hover:text-emerald-800 font-medium">推进</button>
                      <button className="text-red-600 hover:text-red-800 font-medium">淘汰</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- System Management Views ---

function SystemDeptView() {
  const [depts, setDepts] = useState<Dept[]>([]);

  useEffect(() => {
    fetch('/api/depts').then(res => res.json()).then(setDepts);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="搜索部门名称..." className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 focus:ring-2 focus:ring-indigo-500 outline-none" />
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> 新增部门
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">部门名称</th>
              <th className="px-6 py-4 font-medium">负责人</th>
              <th className="px-6 py-4 font-medium">成员数量</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {depts.map(dept => (
              <tr key={dept.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2" style={{ paddingLeft: `${dept.level * 2 + 1.5}rem` }}>
                  {dept.level > 0 && <span className="w-4 h-px bg-slate-300 inline-block mr-1"></span>}
                  <Network className="w-4 h-4 text-indigo-400" />
                  {dept.name}
                </td>
                <td className="px-6 py-4 text-slate-600">{dept.manager}</td>
                <td className="px-6 py-4 text-slate-600">{dept.count} 人</td>
                <td className="px-6 py-4 text-right space-x-3">
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">添加子部门</button>
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">编辑</button>
                  <button className="text-red-600 hover:text-red-800 font-medium">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SystemUserView() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    fetch('/api/users').then(res => res.json()).then(setUsers);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex gap-4">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜索用户名或姓名..." className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-64 focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none text-slate-600">
            <option>全部部门</option>
            <option>华北交付中心</option>
            <option>研发一部</option>
          </select>
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> 新增用户
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">姓名</th>
              <th className="px-6 py-4 font-medium">登录账号</th>
              <th className="px-6 py-4 font-medium">所属部门</th>
              <th className="px-6 py-4 font-medium">角色</th>
              <th className="px-6 py-4 font-medium">状态</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                    {user.name[0]}
                  </div>
                  {user.name}
                </td>
                <td className="px-6 py-4 text-slate-600">{user.username}</td>
                <td className="px-6 py-4 text-slate-600">{user.dept}</td>
                <td className="px-6 py-4">
                  <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-md border border-indigo-100">{user.role}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div> {user.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right space-x-3">
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">编辑</button>
                  <button className="text-red-600 hover:text-red-800 font-medium">停用</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SystemRoleView() {
  const [roles, setRoles] = useState<SysRole[]>([]);

  useEffect(() => {
    fetch('/api/roles').then(res => res.json()).then(setRoles);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="搜索角色名称..." className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 focus:ring-2 focus:ring-indigo-500 outline-none" />
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> 新增角色
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">角色名称</th>
              <th className="px-6 py-4 font-medium">角色描述</th>
              <th className="px-6 py-4 font-medium">关联用户数</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roles.map(role => (
              <tr key={role.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-bold text-slate-900">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-indigo-500" />
                    {role.name}
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600">{role.desc}</td>
                <td className="px-6 py-4 text-slate-600">{role.users} 人</td>
                <td className="px-6 py-4 text-right space-x-3">
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">菜单权限</button>
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">数据权限</button>
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SystemMenuView() {
  const [menus, setMenus] = useState<Menu[]>([]);

  useEffect(() => {
    fetch('/api/menus').then(res => res.json()).then(setMenus);
  }, []);

  const getIcon = (name: string) => {
    switch (name) {
      case 'Briefcase': return <Briefcase className="w-4 h-4" />;
      case 'Building2': return <Building2 className="w-4 h-4" />;
      case 'Users': return <Users className="w-4 h-4" />;
      case 'Search': return <Search className="w-4 h-4" />;
      case 'FileText': return <FileText className="w-4 h-4" />;
      case 'UserCheck': return <UserCheck className="w-4 h-4" />;
      case 'Settings': return <Settings className="w-4 h-4" />;
      default: return <MenuIcon className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="搜索菜单名称..." className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 focus:ring-2 focus:ring-indigo-500 outline-none" />
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> 新增菜单
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">菜单名称</th>
              <th className="px-6 py-4 font-medium">图标</th>
              <th className="px-6 py-4 font-medium">类型</th>
              <th className="px-6 py-4 font-medium">路由路径</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {menus.map(menu => (
              <tr key={menu.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-900" style={{ paddingLeft: `${menu.level * 2 + 1.5}rem` }}>
                  <div className="flex items-center gap-2">
                    {menu.level > 0 && <span className="w-4 h-px bg-slate-300 inline-block mr-1"></span>}
                    {menu.name}
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-500">{getIcon(menu.icon)}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${menu.type === '目录' ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'}`}>
                    {menu.type}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-slate-500">{menu.path}</td>
                <td className="px-6 py-4 text-right space-x-3">
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">添加下级</button>
                  <button className="text-indigo-600 hover:text-indigo-800 font-medium">编辑</button>
                  <button className="text-red-600 hover:text-red-800 font-medium">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
