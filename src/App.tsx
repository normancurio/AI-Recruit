import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  getAdminApiTokenForMiniapp,
  getAdminLoginProfile,
  hasAdminApiCredentials,
  logoutAdminMiniappAuth,
  setAdminLoginProfile,
  setAdminSessionToken,
  subscribeAdminSession,
  type AdminLoginProfile
} from './adminSession';
import { 
  Building2, Briefcase, Users, FileText, UserCheck, 
  Settings, Network, UserCog, Shield, Menu as MenuIcon,
  Search, Plus, UploadCloud, BrainCircuit, ChevronDown,
  ChevronRight, MoreHorizontal, CheckCircle2, XCircle,
  LogOut, Bell, LayoutDashboard, Send, FolderOpen, Bot,
  Clock, Info, Calendar, Pencil, Trash2, Loader2, KeyRound
} from 'lucide-react';

/**
 * 小程序 API 根地址。
 * 1) 生产环境由 server.ts 在 index.html 注入 window.__ADMIN_MINIAPP_API_BASE__（见 MINIAPP_API_PUBLIC_URL），避免构建时写死 localhost 导致线上 ERR_CONNECTION_REFUSED。
 * 2) 否则使用构建期 VITE_API_BASE。
 * 3) 未配时在 localhost 打开则默认同主机 :3001。
 */
function resolveMiniappApiBase(): string {
  if (typeof window !== 'undefined') {
    const injected = String((window as unknown as { __ADMIN_MINIAPP_API_BASE__?: string }).__ADMIN_MINIAPP_API_BASE__ || '').trim()
    if (injected) return injected.replace(/\/$/, '')
  }
  const v = (import.meta.env.VITE_API_BASE || '').trim()
  if (v) return v
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    const local =
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
    if (local) {
      const h = hostname === '[::1]' || hostname === '::1' ? '[::1]' : hostname
      return `${protocol}//${h}:3001`
    }
  }
  if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
    return 'http://127.0.0.1:3001'
  }
  return ''
}

/** 401 后写入，登录层展示后清除 */
const MINIAPP_RELOGIN_HINT_KEY = 'hr_admin_login_hint'

// --- Types ---
type Role = 'admin' | 'delivery_manager' | 'recruiter';

function roleFallbackLabel(r: Role): string {
  if (r === 'admin') return '管理员'
  if (r === 'delivery_manager') return '交付经理'
  return '招聘人员'
}

export interface Client { id: string; name: string; creditCode: string; industry: string; contact: string; phone: string; }
export interface Job {
  id: string;
  project_id: string;
  title: string;
  demand: number;
  location: string;
  skills: string;
  level: string;
  salary: string;
  recruiters: string[];
  jdText?: string;
  department?: string;
  /** jobs.updated_at，用于列表展示 */
  updatedAt?: string;
  /** resume_screenings 表中该 job_code 的记录条数 */
  screeningCount?: number;
}
export interface Project {
  id: string;
  name: string;
  client: string;
  dept: string;
  manager: string;
  status: string;
  jobs: Job[];
  /** 展示用编号，如 PRJ-2024-001 */
  projectCode?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  memberCount?: number;
}
export interface Resume {
  id: string
  name: string
  job: string
  jobCode?: string
  matchScore: number
  skillScore?: number
  experienceScore?: number
  educationScore?: number
  stabilityScore?: number
  /** AI 对简历给出的结论文案（如 AI分析完成、待定） */
  status: string
  /** 招聘漏斗阶段：简历筛查完成 / 已发邀请 / 初面通过 等 */
  flowStage?: string
  uploadTime: string
  reportSummary?: string
}
export interface Application { id: string; name: string; job: string; resumeScore: number; interviewScore: number; aiEval: string; status: string; }
export interface Dept { id: string; name: string; level: number; manager: string; count: number; }
export interface User { id: string; name: string; username: string; dept: string; role: string; status: string; }
export interface SysRole { id: string; name: string; desc: string; users: number; }
export interface Menu { id: string; name: string; type: string; icon: string; path: string; level: number; }

// --- Components ---

export default function App() {
  const [authTick, setAuthTick] = useState(0);
  useEffect(() => subscribeAdminSession(() => setAuthTick((n) => n + 1)), []);
  const miniappApiBase = resolveMiniappApiBase();
  /** 服务端是否声明支持密码登录（仅用于提示；不阻塞登录层显示，避免 auth-status 失败或慢请求导致永远不出现登录框） */
  const [hrApiPasswordLogin, setHrApiPasswordLogin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!miniappApiBase) {
      setHrApiPasswordLogin(null);
      return;
    }
    const base = miniappApiBase.replace(/\/$/, '');
    void fetch(`${base}/api/admin/auth-status`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ passwordLogin?: boolean }>
      })
      .then((j) => setHrApiPasswordLogin(Boolean(j.passwordLogin)))
      .catch(() => setHrApiPasswordLogin(null));
  }, [miniappApiBase]);
  const showHrApiLogin = Boolean(miniappApiBase) && !hasAdminApiCredentials();
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [changePwdCurrent, setChangePwdCurrent] = useState('');
  const [changePwdNew, setChangePwdNew] = useState('');
  const [changePwdConfirm, setChangePwdConfirm] = useState('');
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [changePwdErr, setChangePwdErr] = useState('');
  const [changePwdOk, setChangePwdOk] = useState('');

  const openChangePassword = () => {
    setChangePwdErr('');
    setChangePwdOk('');
    setChangePwdCurrent('');
    setChangePwdNew('');
    setChangePwdConfirm('');
    setChangePwdOpen(true);
  };

  const submitChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePwdErr('');
    setChangePwdOk('');
    if (changePwdNew !== changePwdConfirm) {
      setChangePwdErr('两次输入的新密码不一致');
      return;
    }
    if (changePwdNew.length < 6) {
      setChangePwdErr('新密码至少 6 位');
      return;
    }
    setChangePwdLoading(true);
    try {
      const base = miniappApiBase.replace(/\/$/, '');
      const token = getAdminApiTokenForMiniapp();
      const r = await fetch(`${base}/api/admin/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}`, 'X-Admin-Token': token } : {})
        },
        body: JSON.stringify({
          currentPassword: changePwdCurrent,
          newPassword: changePwdNew
        })
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) throw new Error(j.message || '修改失败');
      setChangePwdOk('密码已更新，请牢记新密码。');
      setChangePwdCurrent('');
      setChangePwdNew('');
      setChangePwdConfirm('');
    } catch (err) {
      setChangePwdErr(err instanceof Error ? err.message : '修改失败');
    } finally {
      setChangePwdLoading(false);
    }
  };

  useEffect(() => {
    if (!showHrApiLogin) return;
    try {
      const hint = sessionStorage.getItem(MINIAPP_RELOGIN_HINT_KEY);
      if (hint) {
        setLoginErr(hint);
        sessionStorage.removeItem(MINIAPP_RELOGIN_HINT_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [showHrApiLogin, authTick]);

  const [authProfile, setAuthProfile] = useState<AdminLoginProfile | null>(() => getAdminLoginProfile());
  useEffect(() => {
    setAuthProfile(getAdminLoginProfile());
  }, [authTick]);
  /** 与登录账号职级一致，不再提供视角切换 */
  const currentRole: Role = authProfile?.uiRole ?? 'delivery_manager';
  const [activeMenu, setActiveMenu] = useState('workbench');
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['projects', 'recruitment', 'system']);

  const submitHrLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr('');
    setLoginLoading(true);
    try {
      const base = miniappApiBase.replace(/\/$/, '');
      const r = await fetch(`${base}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser.trim(), password: loginPass })
      });
      const j = (await r.json().catch(() => ({}))) as {
        message?: string
        data?: { token?: string; user?: AdminLoginProfile }
      };
      if (!r.ok) throw new Error(j.message || `登录失败 ${r.status}`);
      const token = j.data?.token;
      if (!token) throw new Error('未返回 token');
      setAdminSessionToken(token);
      const u = j.data?.user;
      if (u?.uiRole && u.username) {
        setAdminLoginProfile({
          name: String(u.name || u.username),
          username: String(u.username),
          uiRole: u.uiRole
        });
      } else {
        setAdminLoginProfile(null);
      }
      setLoginPass('');
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoginLoading(false);
    }
  };

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
      id: 'workbench',
      title: '工作台',
      icon: <LayoutDashboard className="w-5 h-5" />,
      roles: ['admin', 'delivery_manager', 'recruiter']
    },
    {
      id: 'projects',
      title: '岗位管理',
      icon: <Briefcase className="w-5 h-5" />,
      roles: ['admin', 'delivery_manager', 'recruiter'],
      children: [
        { id: 'project-list', title: '项目管理', roles: ['admin', 'delivery_manager', 'recruiter'], icon: <Briefcase className="w-4 h-4" /> },
        { id: 'job-query', title: '岗位分配', roles: ['admin', 'recruiter'], icon: <UserCog className="w-4 h-4" /> }
      ]
    },
    {
      id: 'recruitment',
      title: '招聘管理',
      icon: <Users className="w-5 h-5" />,
      roles: ['admin', 'recruiter'],
      children: [
        { id: 'resume-screening', title: '简历筛查', roles: ['admin', 'recruiter'] },
        { id: 'application-mgmt', title: '初面管理', roles: ['admin', 'recruiter'] }
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
      case 'workbench': return <WorkbenchView onNavigate={setActiveMenu} currentRole={currentRole} />;
      case 'clients': return <ClientManagementView />;
      case 'project-list': return <ProjectManagementView role={currentRole} onNavigate={setActiveMenu} />;
      case 'job-query': return <JobQueryView onNavigate={setActiveMenu} currentRole={currentRole} authProfile={authProfile} />;
      case 'resume-screening': return <ResumeScreeningView currentRole={currentRole} authProfile={authProfile} />;
      case 'application-mgmt': return <ApplicationManagementView currentRole={currentRole} authProfile={authProfile} />;
      case 'sys-dept': return <SystemDeptView />;
      case 'sys-user': return <SystemUserView />;
      case 'sys-role': return <SystemRoleView />;
      case 'sys-menu': return <SystemMenuView />;
      default: return <div className="p-8 text-slate-500">模块开发中...</div>;
    }
  };

  return (
    <>
      {showHrApiLogin ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/65 p-4">
          <form
            onSubmit={submitHrLogin}
            className="bg-white rounded-xl shadow-xl border border-slate-200 p-8 w-full max-w-md space-y-5"
          >
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">管理端登录</h2>
              <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">
                登录后即可使用简历筛查、面试邀请等与候选人端联动的功能。
              </p>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-violet-50/80 px-4 py-3 shadow-sm">
              <div className="flex gap-2.5">
                <div className="shrink-0 mt-0.5 text-indigo-600">
                  <Info className="w-4 h-4" aria-hidden />
                </div>
                <div className="text-sm text-indigo-950/90 leading-relaxed space-y-2">
                  <p className="font-medium text-indigo-950">请使用后台已开通的账号登录</p>
                  <p className="text-indigo-950/85">
                    用户名与密码由管理员在<strong className="font-semibold text-indigo-950">用户管理</strong>
                    中维护；若部署时已配置访问令牌，一般无需在此登录。
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">用户名</label>
              <input
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                autoComplete="username"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none transition-shadow"
                placeholder="例如 admin"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">密码</label>
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                autoComplete="current-password"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none transition-shadow"
                placeholder="请输入密码"
              />
            </div>
            {loginErr ? (
              <div
                role="alert"
                className="text-sm text-red-800 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5 leading-relaxed"
              >
                {loginErr}
              </div>
            ) : null}
            {hrApiPasswordLogin === false ? (
              <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200/80 rounded-lg px-3.5 py-3 leading-relaxed">
                <p className="font-medium text-amber-950 mb-1">暂时无法在此登录</p>
                <p className="text-amber-900/90">
                  招聘相关服务尚未就绪，请联系贵司技术或运维同事检查后台服务与登录配置；您也可向管理员确认账号是否已开通。
                </p>
              </div>
            ) : null}
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
            >
              {loginLoading ? '登录中…' : '登录'}
            </button>
          </form>
        </div>
      ) : null}
      {changePwdOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="change-pwd-title"
              onClick={() => !changePwdLoading && setChangePwdOpen(false)}
            >
              <form
                onSubmit={submitChangePassword}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 w-full max-w-md space-y-4"
              >
                <div className="flex justify-between items-start gap-4">
                  <h2 id="change-pwd-title" className="text-lg font-bold text-slate-900">
                    修改登录密码
                  </h2>
                  <button
                    type="button"
                    disabled={changePwdLoading}
                    onClick={() => setChangePwdOpen(false)}
                    className="text-slate-400 hover:text-slate-700 text-xl leading-none px-1"
                    aria-label="关闭"
                  >
                    ×
                  </button>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  请使用当前密码验证身份后设置新密码。修改成功后仍保持当前登录状态。
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">当前密码</label>
                  <input
                    type="password"
                    value={changePwdCurrent}
                    onChange={(e) => setChangePwdCurrent(e.target.value)}
                    autoComplete="current-password"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">新密码（至少 6 位）</label>
                  <input
                    type="password"
                    value={changePwdNew}
                    onChange={(e) => setChangePwdNew(e.target.value)}
                    autoComplete="new-password"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">确认新密码</label>
                  <input
                    type="password"
                    value={changePwdConfirm}
                    onChange={(e) => setChangePwdConfirm(e.target.value)}
                    autoComplete="new-password"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                {changePwdErr ? (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{changePwdErr}</p>
                ) : null}
                {changePwdOk ? (
                  <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    {changePwdOk}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={changePwdLoading}
                    onClick={() => setChangePwdOpen(false)}
                    className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    关闭
                  </button>
                  <button
                    type="submit"
                    disabled={changePwdLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {changePwdLoading ? '保存中…' : '保存新密码'}
                  </button>
                </div>
              </form>
            </div>,
            document.body
          )
        : null}
      <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-20">
        <div className="h-16 flex items-center px-6 border-b border-slate-800 bg-slate-950">
          <BrainCircuit className="w-6 h-6 text-indigo-400 mr-3" />
          <span className="text-lg font-bold text-white tracking-wide">智能招聘系统</span>
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
            {authProfile ? (
              <span className="text-sm text-slate-500">
                当前身份：<span className="font-medium text-slate-700">{roleFallbackLabel(currentRole)}</span>
              </span>
            ) : (
              <span className="text-sm text-slate-500">
                未登录账号时按「招聘人员」菜单展示（或使用环境令牌访问）
              </span>
            )}
            <div className="w-px h-6 bg-slate-200"></div>
            {authTick >= 0 && miniappApiBase && hasAdminApiCredentials() && authProfile ? (
              <button
                type="button"
                onClick={openChangePassword}
                className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5"
              >
                <KeyRound className="w-4 h-4" />
                修改密码
              </button>
            ) : null}
            {authTick >= 0 && miniappApiBase && hasAdminApiCredentials() ? (
              <button
                type="button"
                onClick={() => logoutAdminMiniappAuth()}
                className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                退出登录
              </button>
            ) : null}
            <button className="text-slate-400 hover:text-slate-600 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold">
                {currentRole === 'admin' ? 'A' : currentRole === 'delivery_manager' ? 'D' : 'R'}
              </div>
              <span className="text-sm font-medium text-slate-700">
                {authProfile?.name ?? roleFallbackLabel(currentRole)}
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
    </>
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

function defaultNewProjectCode() {
  const y = new Date().getFullYear();
  const n = Math.floor(100 + Math.random() * 900);
  return `PRJ-${y}-${String(n).padStart(3, '0')}`;
}

function ProjectManagementView({
  role,
  onNavigate
}: {
  role: Role;
  onNavigate?: (id: string) => void;
}) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formDept, setFormDept] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [formManager, setFormManager] = useState('');
  const [formStatus, setFormStatus] = useState('进行中');
  const [formMemberCount, setFormMemberCount] = useState('0');
  const [formProjectCode, setFormProjectCode] = useState('');

  const loadProjects = useCallback(() => {
    void fetch('/api/projects')
      .then((res) => res.json())
      .then((data: Project[]) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void fetch('/api/depts')
      .then((res) => res.json())
      .then((rows: Dept[]) => setDepts(Array.isArray(rows) ? rows : []))
      .catch(() => setDepts([]));
  }, []);

  const closeProjectModal = () => {
    if (createSubmitting) return;
    setCreateOpen(false);
    setEditingProjectId(null);
  };

  const openCreateModal = () => {
    const code = defaultNewProjectCode();
    setEditingProjectId(null);
    setFormId(code);
    setFormName('');
    setFormDept('');
    setFormStart('');
    setFormEnd('');
    setFormDesc('');
    setFormManager('');
    setFormStatus('进行中');
    setFormMemberCount('0');
    setFormProjectCode('');
    setCreateError('');
    setCreateOpen(true);
  };

  const openEditProject = (p: Project) => {
    setEditingProjectId(p.id);
    setFormId(p.id);
    setFormName(p.name);
    setFormDept(p.dept && p.dept !== '-' ? p.dept : '');
    setFormStart((p.startDate || '').trim());
    setFormEnd((p.endDate || '').trim());
    setFormDesc((p.description || '').trim());
    setFormManager(p.manager && p.manager !== '-' ? p.manager : '');
    setFormStatus((p.status || '进行中').trim() || '进行中');
    setFormMemberCount(String(p.memberCount ?? 0));
    setFormProjectCode((p.projectCode || p.id || '').trim());
    setCreateError('');
    setCreateOpen(true);
  };

  const handleDeleteProject = async (p: Project) => {
    if (!window.confirm(`确定删除项目「${p.name}」（${p.id}）？下属岗位的 project_id 将清空为未分配。`)) return;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) throw new Error(j.message || `删除失败 ${r.status}`);
      setExpandedProject((ex) => (ex === p.id ? null : ex));
      loadProjects();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    const id = formId.trim();
    const name = formName.trim();
    const isEdit = Boolean(editingProjectId);
    if (!isEdit && (!id || !name)) {
      setCreateError('请填写项目编号与项目名称');
      return;
    }
    if (isEdit && !name) {
      setCreateError('请填写项目名称');
      return;
    }
    const memberCount = Math.max(0, Math.min(9999, Number(formMemberCount) || 0));
    setCreateSubmitting(true);
    try {
      if (isEdit) {
        const r = await fetch(`/api/projects/${encodeURIComponent(editingProjectId!)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            dept: formDept.trim() || null,
            manager: formManager.trim() || null,
            status: formStatus.trim() || '进行中',
            startDate: formStart || null,
            endDate: formEnd || null,
            description: formDesc.trim() || null,
            memberCount,
            projectCode: formProjectCode.trim() || null
          })
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `保存失败 ${r.status}`);
      } else {
        const r = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            name,
            projectCode: id,
            dept: formDept.trim() || undefined,
            manager: formManager.trim() || undefined,
            status: formStatus.trim() || undefined,
            startDate: formStart || undefined,
            endDate: formEnd || undefined,
            description: formDesc.trim() || undefined,
            memberCount
          })
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `创建失败 ${r.status}`);
      }
      setCreateOpen(false);
      setEditingProjectId(null);
      loadProjects();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : isEdit ? '保存失败' : '创建失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const listProjects = projects.filter((p) => p.id !== 'EMPTY' && p.id !== 'UNASSIGNED');

  const dateRangeLabel = (p: Project) => {
    const a = (p.startDate || '').trim();
    const b = (p.endDate || '').trim();
    if (a && b) return `${a} ~ ${b}`;
    if (a) return `${a} ~ —`;
    if (b) return `— ~ ${b}`;
    return '— ~ —';
  };

  const canManage = role === 'admin' || role === 'delivery_manager';

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">项目管理</h1>
          <p className="text-slate-500 mt-1">管理所有招聘项目（数据来自业务库 projects / jobs）</p>
          <p className="text-xs text-slate-400 mt-2 max-w-2xl leading-relaxed">
            岗位的新增与编辑请在「岗位分配」中进行；此处可展开查看明细。列表暂不按角色过滤部门，若需权限隔离请在接口层实现。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManage ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> 创建项目
            </button>
          ) : null}
          {(role === 'admin' || role === 'recruiter') && onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate('job-query')}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-slate-800 px-5 py-2.5 text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm"
            >
              <UserCog className="w-4 h-4" /> 岗位分配
            </button>
          ) : null}
        </div>
      </div>

      {listProjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">
          <p className="text-sm">暂无招聘项目</p>
          {canManage ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              创建第一个项目
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {listProjects.map((project) => {
            const code = (project.projectCode || project.id || '').trim() || project.id;
            const members = project.memberCount ?? 0;
            const desc = (project.description || '').trim();
            return (
              <div
                key={project.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col"
              >
                <div className="p-6 flex-1">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <h2 className="text-lg font-bold text-slate-900 leading-snug pr-2 flex-1 min-w-0">{project.name}</h2>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditProject(project)}
                            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            aria-label="编辑项目"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteProject(project)}
                            className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                            aria-label="删除项目"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : null}
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-900 text-white">
                        {project.status || '进行中'}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs font-mono text-slate-500 mb-3">{code}</p>
                  <div className="space-y-2 text-sm text-slate-600">
                    <p>
                      <span className="text-slate-400">部门</span>{' '}
                      <span className="font-medium text-slate-800">{project.dept || '—'}</span>
                    </p>
                    <p>
                      <span className="text-slate-400">负责人</span>{' '}
                      <span className="font-medium text-slate-800">
                        {project.manager && project.manager !== '-' ? project.manager : '—'}
                      </span>
                    </p>
                    <p className="flex items-center gap-2 text-slate-600">
                      <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                      <span>{dateRangeLabel(project)}</span>
                    </p>
                    <p>
                      <span className="text-slate-400">团队</span>{' '}
                      <span className="font-medium text-slate-800">{members} 名成员</span>
                    </p>
                  </div>
                  {desc ? (
                    <p className="mt-4 text-sm text-slate-600 leading-relaxed line-clamp-3">{desc}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/80 text-sm text-slate-700 hover:bg-slate-50 transition-colors w-full text-left"
                  onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}
                >
                  <span className="font-medium">
                    岗位明细 {project.jobs.length ? `（${project.jobs.length}）` : ''}
                  </span>
                  <ChevronRight
                    className={`w-5 h-5 text-slate-400 transition-transform ${expandedProject === project.id ? 'rotate-90' : ''}`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {expandedProject === project.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-slate-100 bg-slate-50/50"
                    >
                      <div className="p-4 space-y-3">
                        {project.jobs.length === 0 ? (
                          <p className="text-sm text-slate-500 px-2">该项目下暂无岗位</p>
                        ) : (
                          project.jobs.map((job) => (
                            <div
                              key={job.id}
                              className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                            >
                              <div>
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <span className="font-bold text-slate-900">{job.title}</span>
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                                    {job.level}
                                  </span>
                                  <span className="text-orange-600 font-medium text-sm">{job.salary}</span>
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                  <span>
                                    筛查 <strong className="text-slate-700">{job.screeningCount ?? 0}</strong> 条 · 需求{' '}
                                    <strong className="text-slate-700">{job.demand} 人</strong>
                                  </span>
                                  <span>地点 {job.location}</span>
                                </div>
                              </div>
                              <div className="text-left sm:text-right">
                                <div className="text-xs text-slate-500 mb-1">可见招聘人员</div>
                                <div className="flex flex-wrap gap-1 sm:justify-end">
                                  {job.recruiters.map((r) => (
                                    <span
                                      key={r}
                                      className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-md border border-indigo-100"
                                    >
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                        {(role === 'admin' || role === 'recruiter') && onNavigate ? (
                          <button
                            type="button"
                            onClick={() => onNavigate('job-query')}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 pt-1 text-left w-full"
                          >
                            在「岗位分配」中编辑岗位、JD 与招聘负责人 →
                          </button>
                        ) : (
                          <p className="text-xs text-slate-400 px-2 pt-1">
                            岗位由管理员或招聘同学在「岗位分配」中维护。
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {createOpen ? (
                <motion.div
                  key="create-project-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/50"
                  onClick={() => !createSubmitting && closeProjectModal()}
                >
                  <motion.div
                    key="create-project-modal"
                    initial={{ opacity: 0, scale: 0.97, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 8 }}
                    transition={{ duration: 0.2 }}
                    className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[min(90vh,640px)] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">
                  {editingProjectId ? '编辑项目' : '创建新招聘项目'}
                </h3>
                <button
                  type="button"
                  disabled={createSubmitting}
                  onClick={closeProjectModal}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  aria-label="关闭"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={submitCreate} className="flex flex-col flex-1 min-h-0">
                <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">项目名称</label>
                    <input
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 outline-none"
                      placeholder="例如：2024 技术部招聘"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">项目编号</label>
                    <input
                      value={formId}
                      onChange={(e) => setFormId(e.target.value)}
                      disabled={Boolean(editingProjectId)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                      placeholder="PRJ-2024-001"
                      required={!editingProjectId}
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      {editingProjectId ? '项目主键不可修改' : '作为主键写入数据库，需唯一'}
                    </p>
                  </div>
                  {editingProjectId ? (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">展示编号（project_code）</label>
                      <input
                        value={formProjectCode}
                        onChange={(e) => setFormProjectCode(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 outline-none"
                        placeholder="与列表展示一致"
                      />
                    </div>
                  ) : null}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">所属部门</label>
                    <select
                      value={formDept}
                      onChange={(e) => setFormDept(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 outline-none"
                    >
                      <option value="">选择部门</option>
                      {depts.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">负责人</label>
                      <input
                        value={formManager}
                        onChange={(e) => setFormManager(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900/20 outline-none"
                        placeholder="可选"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">项目状态</label>
                      <select
                        value={formStatus}
                        onChange={(e) => setFormStatus(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-slate-900/20 outline-none"
                      >
                        <option value="进行中">进行中</option>
                        <option value="待归档">待归档</option>
                        <option value="已结束">已结束</option>
                        <option value="已关闭">已关闭</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">团队人数（member_count）</label>
                    <input
                      type="number"
                      min={0}
                      max={9999}
                      value={formMemberCount}
                      onChange={(e) => setFormMemberCount(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums focus:ring-2 focus:ring-slate-900/20 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">开始日期</label>
                      <input
                        type="date"
                        value={formStart}
                        onChange={(e) => setFormStart(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900/20 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">结束日期</label>
                      <input
                        type="date"
                        value={formEnd}
                        onChange={(e) => setFormEnd(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900/20 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">项目描述</label>
                    <textarea
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      rows={3}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900/20 outline-none resize-none"
                      placeholder="简要说明招聘背景与岗位范围"
                    />
                  </div>
                  {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
                </div>
                <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/80 rounded-b-2xl">
                  <button
                    type="button"
                    disabled={createSubmitting}
                    onClick={closeProjectModal}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={createSubmitting}
                    className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                  >
                    {createSubmitting
                      ? editingProjectId
                        ? '保存中…'
                        : '创建中…'
                      : editingProjectId
                        ? '保存更改'
                        : '创建项目'}
                  </button>
                </div>
              </form>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
}

async function miniappApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = resolveMiniappApiBase().replace(/\/$/, '');
  const token = getAdminApiTokenForMiniapp();
  const url = base ? `${base}${path}` : path;
  const h = new Headers(init?.headers);
  if (token) {
    h.set('Authorization', `Bearer ${token}`);
    h.set('X-Admin-Token', token);
  }
  if (init?.body && !(init.body instanceof FormData) && !h.has('Content-Type')) {
    h.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers: h });
  if (res.status === 401) {
    try {
      sessionStorage.setItem(
        MINIAPP_RELOGIN_HINT_KEY,
        '登录已失效或没有权限，请重新登录。若多次失败，请联系管理员确认账号或系统配置。'
      );
    } catch {
      /* ignore */
    }
    logoutAdminMiniappAuth();
  }
  return res;
}

type WorkbenchTodo = {
  key: string;
  title: string;
  note: string;
  cta: string;
  priority: number;
  tag: string;
  tagClass: string;
  borderClass: string;
  menuId: string;
  show: boolean;
};

type WorkbenchStatsPayload = {
  resumeScreeningCount: number;
  pendingAnalysisCount: number;
  pendingReviewCount: number;
  interviewReportCount: number;
  interviewPassedCount: number;
  pendingInviteCount: number;
  pendingReportCount: number;
  timeoutResumeCount: number;
  timeoutInviteCount: number;
  exceptionCount: number;
  focusJobAlertCount: number;
  recentScreenings: Array<{
    id: number | string;
    candidate_name: string;
    matched_job_title: string;
    match_score: number;
    status: string;
  }>;
};

function WorkbenchView({
  onNavigate,
  currentRole
}: {
  onNavigate: (id: string) => void;
  currentRole: Role;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [wbStats, setWbStats] = useState<WorkbenchStatsPayload | null>(null);
  const [wbStatsLoading, setWbStatsLoading] = useState(false);
  const [wbStatsOk, setWbStatsOk] = useState(false);
  const [sessRev, setSessRev] = useState(0);
  useEffect(() => subscribeAdminSession(() => setSessRev((n) => n + 1)), []);
  const apiBase = resolveMiniappApiBase();
  const hasToken = hasAdminApiCredentials();
  void sessRev;

  useEffect(() => {
    void fetch('/api/projects')
      .then((res) => res.json())
      .then((data: Project[]) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!apiBase || !hasToken) {
      setWbStats(null);
      setWbStatsOk(false);
      setWbStatsLoading(false);
      return;
    }
    setWbStatsLoading(true);
    void miniappApiFetch('/api/admin/workbench-stats')
      .then(async (r) => {
        const j = (await r.json()) as { data?: WorkbenchStatsPayload; message?: string };
        if (!r.ok) throw new Error(j.message || 'fail');
        const d = j.data;
        if (!d || typeof d !== 'object') throw new Error('invalid payload');
        setWbStats({
          resumeScreeningCount: Number(d.resumeScreeningCount) || 0,
          pendingAnalysisCount: Number(d.pendingAnalysisCount) || 0,
          pendingReviewCount: Number(d.pendingReviewCount) || 0,
          interviewReportCount: Number(d.interviewReportCount) || 0,
          interviewPassedCount: Number(d.interviewPassedCount) || 0,
          pendingInviteCount: Number(d.pendingInviteCount) || 0,
          pendingReportCount: Number(d.pendingReportCount) || 0,
          timeoutResumeCount: Number(d.timeoutResumeCount) || 0,
          timeoutInviteCount: Number(d.timeoutInviteCount) || 0,
          exceptionCount: Number(d.exceptionCount) || 0,
          focusJobAlertCount: Number(d.focusJobAlertCount) || 0,
          recentScreenings: Array.isArray(d.recentScreenings) ? d.recentScreenings : []
        });
        setWbStatsOk(true);
      })
      .catch(() => {
        setWbStats(null);
        setWbStatsOk(false);
      })
      .finally(() => setWbStatsLoading(false));
  }, [apiBase, hasToken, sessRev]);

  const activeProjectCount = projects.filter(
    (p) => !['EMPTY', 'UNASSIGNED'].includes(p.id) && !/待归档|已结束|已关闭/.test(p.status)
  ).length;

  const resumeReceivedCount = wbStatsOk && wbStats ? wbStats.resumeScreeningCount : null;
  const aiInterviewCount = wbStatsOk && wbStats ? wbStats.interviewReportCount : null;
  const interviewPassedCount = wbStatsOk && wbStats ? wbStats.interviewPassedCount : null;

  const pendingAiAnalysis =
    wbStatsOk && wbStats ? wbStats.pendingAnalysisCount : 0;
  const pendingReviewCount = wbStatsOk && wbStats ? wbStats.pendingReviewCount : 0;
  const pendingInviteCount = wbStatsOk && wbStats ? wbStats.pendingInviteCount : 0;
  const pendingReportCount = wbStatsOk && wbStats ? wbStats.pendingReportCount : 0;
  const timeoutResumeCount = wbStatsOk && wbStats ? wbStats.timeoutResumeCount : 0;
  const timeoutInviteCount = wbStatsOk && wbStats ? wbStats.timeoutInviteCount : 0;
  const exceptionCount = wbStatsOk && wbStats ? wbStats.exceptionCount : 0;
  const focusJobAlertCount = wbStatsOk && wbStats ? wbStats.focusJobAlertCount : 0;

  const todos: WorkbenchTodo[] = [
    {
      key: 'ai',
      title: `${pendingAiAnalysis} 份简历待 AI 分析`,
      note: '建议今天内完成首轮分析，避免候选人长时间停留在初筛阶段。',
      cta: '去简历筛查处理',
      priority: 100,
      tag: '紧急',
      tagClass: 'bg-red-500 text-white',
      borderClass: 'border-red-200 bg-red-50/40',
      menuId: 'resume-screening',
      show: pendingAiAnalysis > 0 && (currentRole === 'admin' || currentRole === 'recruiter')
    },
    {
      key: 'review',
      title: `${pendingReviewCount} 条筛查为「待定」，建议复核`,
      note: '优先复核高匹配但状态未推进的候选人，缩短决策链路。',
      cta: '去复核筛查结果',
      priority: 80,
      tag: '待处理',
      tagClass: 'bg-white text-slate-800 border border-slate-200',
      borderClass: 'border-amber-200 bg-amber-50/30',
      menuId: 'resume-screening',
      show: pendingReviewCount > 0 && (currentRole === 'admin' || currentRole === 'recruiter')
    },
    {
      key: 'invite',
      title: `${pendingInviteCount} 位候选人达到邀约条件，待发送初面邀请`,
      note: '建议 24 小时内完成邀约，减少候选人流失。',
      cta: '去发送初面邀请',
      priority: 75,
      tag: '动作',
      tagClass: 'bg-indigo-600 text-white',
      borderClass: 'border-indigo-200 bg-indigo-50/40',
      menuId: 'application-mgmt',
      show: pendingInviteCount > 0 && (currentRole === 'admin' || currentRole === 'recruiter')
    },
    {
      key: 'report',
      title: `${pendingReportCount} 场面试已完成，待补充面试报告`,
      note: '报告补齐后可用于工作台与筛查联动，建议当日闭环。',
      cta: '去补录面试报告',
      priority: 70,
      tag: '动作',
      tagClass: 'bg-violet-600 text-white',
      borderClass: 'border-violet-200 bg-violet-50/40',
      menuId: 'application-mgmt',
      show: pendingReportCount > 0 && (currentRole === 'admin' || currentRole === 'delivery_manager')
    },
    {
      key: 'timeout',
      title: `${timeoutResumeCount + timeoutInviteCount} 条任务已超时（简历/邀约）`,
      note: '含超过 24h 未推进简历与超过 48h 未响应邀约，建议优先清理。',
      cta: '去处理超时任务',
      priority: 95,
      tag: '超时',
      tagClass: 'bg-rose-600 text-white',
      borderClass: 'border-rose-200 bg-rose-50/40',
      menuId: 'resume-screening',
      show: timeoutResumeCount + timeoutInviteCount > 0
    },
    {
      key: 'exception',
      title: `${exceptionCount} 条异常记录待人工处理`,
      note: '包含处理失败/异常状态，建议先排障再恢复流程推进。',
      cta: '去查看异常记录',
      priority: 90,
      tag: '异常',
      tagClass: 'bg-slate-800 text-white',
      borderClass: 'border-slate-300 bg-slate-50',
      menuId: 'application-mgmt',
      show: exceptionCount > 0
    },
    {
      key: 'hc',
      title: `${focusJobAlertCount} 个重点岗位存在 HC 缺口`,
      note: '岗位筛查量不足以覆盖需求编制，建议加大投放或调整优先级。',
      cta: '去查看岗位缺口',
      priority: 60,
      tag: '关注',
      tagClass: 'bg-emerald-600 text-white',
      borderClass: 'border-emerald-200 bg-emerald-50/40',
      menuId: 'job-query',
      show: focusJobAlertCount > 0
    }
  ]
    .filter((t) => t.show)
    .sort((a, b) => b.priority - a.priority);

  const recentProjects = projects
    .filter((p) => !['EMPTY', 'UNASSIGNED'].includes(p.id))
    .slice(0, 5);

  const recentCandidates = wbStatsOk && wbStats ? wbStats.recentScreenings : [];

  const statCards: Array<{
    key: string;
    label: string;
    sublabel?: string;
    icon: typeof FolderOpen;
    iconWrap: string;
    displayValue: string;
  }> = [
    {
      key: 'proj',
      label: '在招项目',
      icon: FolderOpen,
      iconWrap: 'bg-sky-100 text-sky-600',
      displayValue: String(activeProjectCount)
    },
    {
      key: 'resume',
      label: '收到简历',
      sublabel: '简历筛查记录数',
      icon: Users,
      iconWrap: 'bg-emerald-100 text-emerald-600',
      displayValue:
        !hasToken ? '—' : wbStatsLoading ? '…' : wbStatsOk && resumeReceivedCount !== null ? String(resumeReceivedCount) : '—'
    },
    {
      key: 'ai',
      label: '面试报告',
      sublabel: '候选人完成答题生成的报告',
      icon: Bot,
      iconWrap: 'bg-violet-100 text-violet-600',
      displayValue:
        !hasToken ? '—' : wbStatsLoading ? '…' : wbStatsOk && aiInterviewCount !== null ? String(aiInterviewCount) : '—'
    },
    {
      key: 'hire',
      label: '面试通过',
      sublabel: '报告中标记为通过',
      icon: UserCheck,
      iconWrap: 'bg-orange-100 text-orange-600',
      displayValue:
        !hasToken ? '—' : wbStatsLoading ? '…' : wbStatsOk && interviewPassedCount !== null ? String(interviewPassedCount) : '—'
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">工作台</h1>
        <p className="text-slate-500 mt-1">欢迎使用智能招聘管理系统</p>
        <p className="text-xs text-slate-400 mt-2 max-w-2xl leading-relaxed">
          简历与面试相关统计来自「简历筛查」与「面试报告」；在招项目数来自项目列表。请先登录以加载业务数据（本页已不使用管理库中的演示投递/简历数据）。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {statCards.map((c) => (
          <div
            key={c.key}
            className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 flex items-center gap-4"
          >
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${c.iconWrap}`}
            >
              <c.icon className="w-7 h-7" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-500">{c.label}</p>
              {c.sublabel ? (
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{c.sublabel}</p>
              ) : null}
              <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1">{c.displayValue}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-500" />
          <h2 className="font-bold text-slate-900">待办事项</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {todos.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">暂无待办，数据将随业务自动汇总</div>
          ) : (
            todos.map((t, idx) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onNavigate(t.menuId)}
                className={`w-full flex items-center justify-between gap-4 px-6 py-4 text-left border-l-4 border-l-transparent hover:bg-slate-50/80 transition-colors ${t.borderClass}`}
              >
                <span className="min-w-0">
                  <span className="text-sm text-slate-800 block">
                    <span className="text-slate-400 mr-1">{`${idx + 1}.`}</span>
                    {t.title}
                  </span>
                  <span className="text-xs text-slate-500 mt-1 block">{t.note}</span>
                  <span className="text-xs font-medium text-indigo-600 mt-1.5 inline-flex items-center gap-1">
                    {t.cta}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </span>
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md ${t.tagClass}`}>
                  {t.tag}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">最近项目</h2>
            {(currentRole === 'admin' || currentRole === 'delivery_manager') && (
              <button
                type="button"
                onClick={() => onNavigate('project-list')}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                查看全部
              </button>
            )}
          </div>
          <div className="p-4 space-y-3">
            {recentProjects.length === 0 ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">暂无项目数据</p>
            ) : (
              recentProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onNavigate('project-list')}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{p.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {p.dept || '—'}
                      {p.manager && p.manager !== '-' ? ` · 负责人 ${p.manager}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-slate-900 text-white">
                    {p.status || '进行中'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">最近筛查候选人</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">与简历筛查列表一致，登录后展示</p>
            </div>
            {(currentRole === 'admin' || currentRole === 'recruiter') && (
              <button
                type="button"
                onClick={() => onNavigate('resume-screening')}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                简历筛查
              </button>
            )}
          </div>
          <div className="p-4 space-y-3">
            {!hasToken ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">请登录后查看最近筛查记录</p>
            ) : wbStatsLoading ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">加载中…</p>
            ) : recentCandidates.length === 0 ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">暂无筛查记录，可在简历上传中提交简历</p>
            ) : (
              recentCandidates.map((row) => (
                <button
                  key={String(row.id)}
                  type="button"
                  onClick={() => onNavigate('resume-screening')}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                      {(row.candidate_name || '?')[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{row.candidate_name || '—'}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {row.matched_job_title || '—'} · 匹配 {row.match_score}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-slate-900 text-white">
                    {row.status || '—'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type JobAssignmentRow = {
  job: Job;
  projectName: string;
  projectManager: string;
  /** 来自所属 projects.status，岗位表无单独状态时作展示参考 */
  projectStatus: string;
};

function parseRecruitersInput(s: string): string[] {
  return s
    .split(/[,，、\n\r]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function recruiterIdentityKeys(profile: AdminLoginProfile | null): string[] {
  const uname = String(profile?.username || '').trim().toLowerCase();
  const name = String(profile?.name || '').trim().toLowerCase();
  return [uname, name].filter(Boolean);
}

function recruitersContainMe(recruiters: string[] | undefined, meKeys: string[]): boolean {
  if (!meKeys.length) return false;
  const rs = (recruiters || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  if (!rs.length) return false;
  return rs.some((r) => meKeys.includes(r));
}

function useRecruiterScopedJobCodes(currentRole: Role, authProfile: AdminLoginProfile | null) {
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (currentRole !== 'recruiter') {
      setCodes([]);
      setLoading(false);
      return;
    }
    const meKeys = recruiterIdentityKeys(authProfile);
    if (!meKeys.length) {
      setCodes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetch('/api/projects')
      .then((res) => res.json())
      .then((rows: Project[]) => {
        if (!Array.isArray(rows)) {
          setCodes([]);
          return;
        }
        const out = new Set<string>();
        for (const p of rows) {
          for (const j of p.jobs || []) {
            if (recruitersContainMe(j.recruiters, meKeys)) {
              if (j.id) out.add(String(j.id));
            }
          }
        }
        setCodes(Array.from(out));
      })
      .catch(() => setCodes([]))
      .finally(() => setLoading(false));
  }, [authProfile, currentRole]);

  useEffect(() => {
    load();
  }, [load]);

  return { codes, loading };
}

function jobAssignmentOwner(job: Job, projectManager: string): string {
  if (job.recruiters?.length) return job.recruiters.join('、');
  if (projectManager && projectManager !== '-') return projectManager;
  return '—';
}

type JobFormState = {
  mode: 'create' | 'edit';
  submitting: boolean;
  error: string;
  jobCode: string;
  title: string;
  projectId: string;
  department: string;
  demand: string;
  location: string;
  skills: string;
  level: string;
  salary: string;
  recruiters: string;
  jdText: string;
};

function JobQueryView({
  onNavigate,
  currentRole,
  authProfile
}: {
  onNavigate: (id: string) => void;
  currentRole: Role;
  authProfile: AdminLoginProfile | null;
}) {
  const [rows, setRows] = useState<JobAssignmentRow[]>([]);
  const [projectOptions, setProjectOptions] = useState<Project[]>([]);
  const [jobForm, setJobForm] = useState<JobFormState | null>(null);

  const loadData = useCallback(() => {
    void fetch('/api/projects')
      .then((res) => res.json())
      .then((data: Project[]) => {
        if (!Array.isArray(data)) {
          setProjectOptions([]);
          setRows([]);
          return;
        }
        setProjectOptions(data);
        const out: JobAssignmentRow[] = [];
        const meKeys = recruiterIdentityKeys(authProfile);
        for (const p of data) {
          if (p.id === 'EMPTY') continue;
          const pname = p.id === 'UNASSIGNED' ? '未分配项目岗位' : p.name;
          const pm = p.manager || '—';
          for (const job of p.jobs || []) {
            if (currentRole === 'recruiter') {
              if (!recruitersContainMe(job.recruiters, meKeys)) continue;
            }
            out.push({
              job,
              projectName: pname,
              projectManager: pm,
              projectStatus: String(p.status || '').trim() || '—'
            });
          }
        }
        out.sort((a, b) => {
          const ta = a.job.updatedAt || '';
          const tb = b.job.updatedAt || '';
          return tb.localeCompare(ta);
        });
        setRows(out);
      })
      .catch(() => {
        setProjectOptions([]);
        setRows([]);
      });
  }, [authProfile?.name, authProfile?.username, currentRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectableProjects = projectOptions.filter((p) => !['EMPTY', 'UNASSIGNED'].includes(p.id));

  const openCreate = () => {
    if (currentRole === 'recruiter') return;
    const first = selectableProjects[0];
    setJobForm({
      mode: 'create',
      submitting: false,
      error: '',
      jobCode: '',
      title: '',
      projectId: first?.id ?? '',
      department: '',
      demand: '1',
      location: '',
      skills: '',
      level: '',
      salary: '',
      recruiters: '',
      jdText: ''
    });
  };

  const openEdit = (job: Job) => {
    if (currentRole === 'recruiter') return;
    const pid = job.project_id === 'UNASSIGNED' ? '' : job.project_id || '';
    setJobForm({
      mode: 'edit',
      submitting: false,
      error: '',
      jobCode: job.id,
      title: job.title,
      projectId: pid,
      department: job.department && job.department !== '-' ? job.department : '',
      demand: String(job.demand ?? 1),
      location: job.location && job.location !== '-' ? job.location : '',
      skills: job.skills && job.skills !== '见 JD' ? job.skills : '',
      level: job.level && job.level !== '待评估' ? job.level : '',
      salary: job.salary && job.salary !== '面议' ? job.salary : '',
      recruiters: job.recruiters?.length ? job.recruiters.join('、') : '',
      jdText: job.jdText || ''
    });
  };

  const submitJobForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobForm) return;
    const title = jobForm.title.trim();
    if (!title) {
      setJobForm((f) => (f ? { ...f, error: '请填写岗位名称' } : f));
      return;
    }
    setJobForm((f) => (f ? { ...f, submitting: true, error: '' } : f));
    const recruiters = parseRecruitersInput(jobForm.recruiters);
    const demand = Math.max(1, Math.min(99999, Number(jobForm.demand) || 1));
    const projectId = jobForm.projectId.trim() || null;
    const payload = {
      title,
      projectId,
      department: jobForm.department.trim() || null,
      demand,
      location: jobForm.location.trim() || null,
      skills: jobForm.skills.trim() || null,
      level: jobForm.level.trim() || null,
      salary: jobForm.salary.trim() || null,
      recruiters,
      jdText: jobForm.jdText.trim() || null
    };
    try {
      if (jobForm.mode === 'create') {
        const jc = jobForm.jobCode.trim();
        const body: Record<string, unknown> = { ...payload };
        if (jc) body.jobCode = jc.toUpperCase();
        const r = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `创建失败 ${r.status}`);
      } else {
        const r = await fetch(`/api/jobs/${encodeURIComponent(jobForm.jobCode)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `保存失败 ${r.status}`);
      }
      setJobForm(null);
      loadData();
    } catch (err) {
      setJobForm((f) =>
        f
          ? {
              ...f,
              submitting: false,
              error: err instanceof Error ? err.message : '请求失败'
            }
          : f
      );
    }
  };

  const handleDeleteJob = async (job: Job) => {
    if (!window.confirm(`确定删除岗位「${job.title}」（${job.id}）？不可恢复。`)) return;
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) throw new Error(j.message || `删除失败 ${r.status}`);
      loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">岗位分配</h1>
        <p className="text-slate-500 mt-1">为招聘项目分配岗位需求</p>
        <p className="text-xs text-slate-400 mt-2 max-w-3xl leading-relaxed">
          HC 列为「简历筛查条数 / 需求人数」：左侧为业务库 <span className="font-mono text-slate-500">resume_screenings</span>{' '}
          按岗位码汇总；右侧为岗位编制需求。状态列为所属
          <span className="font-medium text-slate-600">项目</span>
          状态（非岗位独立状态）。
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <h2 className="text-base font-bold text-slate-900">岗位列表</h2>
          {currentRole !== 'recruiter' ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
              aria-label="添加岗位"
            >
              <Plus className="w-5 h-5" />
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[960px]">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 font-medium whitespace-nowrap">岗位名称</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">所属部门</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">负责人</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">JD</th>
                <th
                  className="px-5 py-3 font-medium whitespace-nowrap"
                  title="筛查记录数 / 需求人数"
                >
                  HC
                </th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">薪资范围</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">地点</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">列表时间</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">项目状态</th>
                <th className="px-5 py-3 font-medium text-right whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-slate-500">
                    暂无岗位数据，请点击右上角「+」添加
                  </td>
                </tr>
              ) : (
                rows.map(({ job, projectName, projectManager, projectStatus }) => {
                  const dept = job.department && job.department !== '-' ? job.department : '—';
                  const screenN = job.screeningCount ?? 0;
                  const hc = `${screenN}/${job.demand}`;
                  const owner = jobAssignmentOwner(job, projectManager);
                  const when = (job.updatedAt || '').trim() || '—';
                  const ps = projectStatus || '—';
                  const statusMuted = /待归档|已结束|已关闭/.test(ps);
                  return (
                    <tr key={`${job.project_id}-${job.id}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-4 align-top">
                        <p className="font-semibold text-slate-900">{job.title}</p>
                        <p className="text-xs font-mono text-slate-500 mt-0.5" title="岗位码，用于筛查/邀请/报告关联">
                          {job.id}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{projectName}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-700 align-top">{dept}</td>
                      <td className="px-5 py-4 text-slate-700 align-top max-w-[140px]">
                        <span className="line-clamp-2" title={owner}>
                          {owner}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-700 align-top max-w-[320px]">
                        <span className="line-clamp-2" title={job.jdText || '—'}>
                          {job.jdText || '—'}
                        </span>
                      </td>
                      <td
                        className="px-5 py-4 text-slate-800 font-medium tabular-nums align-top"
                        title="左侧：该岗位在简历筛查中的记录条数；右侧：需求人数"
                      >
                        {hc}
                      </td>
                      <td className="px-5 py-4 text-slate-800 align-top whitespace-nowrap">{job.salary}</td>
                      <td className="px-5 py-4 text-slate-700 align-top">{job.location}</td>
                      <td className="px-5 py-4 text-slate-600 tabular-nums align-top whitespace-nowrap text-xs">
                        {when}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-md text-xs font-medium border ${
                            statusMuted
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-100'
                          }`}
                          title="取自该项目在项目管理中的状态"
                        >
                          {ps}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top text-right">
                        {currentRole !== 'recruiter' ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(job)}
                              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                              aria-label="编辑"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteJob(job)}
                              className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                              aria-label="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {jobForm ? (
                <motion.div
                  key="job-form-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/50"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="job-form-title"
                  onClick={() => !jobForm.submitting && setJobForm(null)}
                >
                  <motion.div
                    key="job-form-modal"
                    initial={{ opacity: 0, scale: 0.97, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 8 }}
                    transition={{ duration: 0.2 }}
                    className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[min(92vh,720px)] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                      <div>
                        <h3 id="job-form-title" className="text-lg font-bold text-slate-900">
                          {jobForm.mode === 'create' ? '添加岗位' : '编辑岗位'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          数据写入业务库 jobs 表；所属项目需已在项目管理中创建。
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={jobForm.submitting}
                        onClick={() => setJobForm(null)}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        aria-label="关闭"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                    </div>
                    <form onSubmit={submitJobForm} className="flex flex-col flex-1 min-h-0">
                      <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">岗位编码</label>
                            <input
                              value={jobForm.jobCode}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, jobCode: e.target.value.toUpperCase() } : f))
                              }
                              disabled={jobForm.mode === 'edit' || jobForm.submitting}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono disabled:bg-slate-50 disabled:text-slate-500"
                              placeholder="留空则系统自动生成"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">所属项目</label>
                            <select
                              value={jobForm.projectId}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, projectId: e.target.value } : f))
                              }
                              disabled={jobForm.submitting}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                            >
                              <option value="">不关联项目</option>
                              {selectableProjects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">岗位名称 *</label>
                          <input
                            value={jobForm.title}
                            onChange={(e) => setJobForm((f) => (f ? { ...f, title: e.target.value } : f))}
                            required
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="例如：高级前端工程师"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">所属部门</label>
                            <input
                              value={jobForm.department}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, department: e.target.value } : f))
                              }
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="例如：技术部"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">HC（需求人数）</label>
                            <input
                              type="number"
                              min={1}
                              value={jobForm.demand}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, demand: e.target.value } : f))
                              }
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">地点</label>
                            <input
                              value={jobForm.location}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, location: e.target.value } : f))
                              }
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="例如：北京"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">薪资范围</label>
                            <input
                              value={jobForm.salary}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, salary: e.target.value } : f))
                              }
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="例如：25-35万"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">级别</label>
                            <input
                              value={jobForm.level}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, level: e.target.value } : f))
                              }
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="例如：高级"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">技能关键词</label>
                            <input
                              value={jobForm.skills}
                              onChange={(e) =>
                                setJobForm((f) => (f ? { ...f, skills: e.target.value } : f))
                              }
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="例如：React, TypeScript"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">
                            招聘负责人（可见招聘，逗号或顿号分隔）
                          </label>
                          <input
                            value={jobForm.recruiters}
                            onChange={(e) =>
                              setJobForm((f) => (f ? { ...f, recruiters: e.target.value } : f))
                            }
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="张三、李四"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1.5">职位描述（JD）</label>
                          <textarea
                            value={jobForm.jdText}
                            onChange={(e) =>
                              setJobForm((f) => (f ? { ...f, jdText: e.target.value } : f))
                            }
                            rows={5}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                            placeholder="岗位职责与任职要求"
                          />
                        </div>
                        {jobForm.error ? (
                          <p className="text-sm text-red-600">{jobForm.error}</p>
                        ) : null}
                      </div>
                      <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex flex-wrap justify-end gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={jobForm.submitting}
                          onClick={() => setJobForm(null)}
                          className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={jobForm.submitting}
                          onClick={() => {
                            setJobForm(null);
                            onNavigate('resume-screening');
                          }}
                          className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100"
                        >
                          去筛简历
                        </button>
                        <button
                          type="submit"
                          disabled={jobForm.submitting}
                          className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                        >
                          {jobForm.submitting ? '保存中…' : '保存'}
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
}

function deriveResumeDimsFromOverall(score: number) {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  return {
    skill: Math.max(0, Math.min(100, s + 7)),
    experience: Math.max(0, Math.min(100, s + 2)),
    education: Math.max(0, Math.min(100, s + 10)),
    stability: Math.max(0, Math.min(100, s - 12))
  }
}

/** 流程：AI 筛查 → 发面试邀请 → 候选人答题/面试 → 面试报告；与 pipeline_stage、interview_reports 关联展示 */
function deriveScreeningFlowLabels(row: Record<string, unknown>): { flowStage: string; aiConclusion: string } {
  const aiConclusion = String(row.status ?? '').trim() || '—'
  const ivRaw = row.interview_overall_score
  const updatedAt = row.interview_report_updated_at
  const hasUpdated = updatedAt !== null && updatedAt !== undefined && String(updatedAt).trim() !== ''
  const ivParsed =
    ivRaw !== null && ivRaw !== undefined && String(ivRaw).trim() !== ''
      ? Math.max(0, Math.min(100, Number(ivRaw) || 0))
      : null
  const hasInterviewReport = hasUpdated || ivParsed !== null
  if (hasInterviewReport) {
    const passedN = Number(row.interview_passed)
    if (passedN === 1) return { flowStage: '初面通过', aiConclusion }
    if (passedN === 0) return { flowStage: '初面待提升', aiConclusion }
    return { flowStage: '初面已完成', aiConclusion }
  }
  const pip = String(row.pipeline_stage ?? '').trim()
  if (pip === 'report_done') return { flowStage: '面试报告已出具', aiConclusion }
  if (pip === 'invited') return { flowStage: '已发面试邀请', aiConclusion }
  return { flowStage: '简历筛查完成', aiConclusion }
}

function fmtAdminListDateTime(v: unknown): string {
  if (v == null || v === '') return ''
  try {
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  } catch {
    return ''
  }
}

/** 初面管理「面试情况」：补充流程阶段与报告之间的业务说明 */
function deriveInterviewSituation(row: Record<string, unknown>, hasInterviewReport: boolean): string {
  const pip = String(row.pipeline_stage ?? '').trim()
  const reportAt = fmtAdminListDateTime(row.interview_report_updated_at)
  const sessSt = String(row.interview_session_status ?? '').trim()
  const voip = String(row.interview_session_voip ?? '').trim()
  const sessParts: string[] = []
  if (sessSt === 'created') sessParts.push('面试会话已创建')
  else if (sessSt) sessParts.push(`会话：${sessSt}`)
  if (voip === 'connected') sessParts.push('音视频曾接通')
  else if (voip && voip !== 'not_started') sessParts.push(`通话：${voip}`)
  const sessHint = sessParts.join(' · ')

  if (hasInterviewReport) {
    const timePart = reportAt ? `报告更新 ${reportAt}` : ''
    return ['已提交初面并生成面试报告', timePart, sessHint].filter(Boolean).join(' · ')
  }
  if (pip === 'report_done') {
    return '库中标记为已有报告，但当前行未关联到报告（多为面试填写姓名与筛查不一致），请核对姓名与岗位码。'
  }
  if (pip === 'invited') {
    return '已对该筛查记录发起邀请；尚未产生可关联的面试报告。请确认候选人已用邀请码登录并完成答题/面试。'
  }
  return '尚未从简历筛查页面对该记录发起邀请，候选人未进入面试流程。'
}

function dimsFromScreeningDbRow(
  row: {
    skill_score?: number | null
    experience_score?: number | null
    education_score?: number | null
    stability_score?: number | null
  },
  overall: number
) {
  const skill = Math.max(0, Math.min(100, Number(row.skill_score) || 0))
  const experience = Math.max(0, Math.min(100, Number(row.experience_score) || 0))
  const education = Math.max(0, Math.min(100, Number(row.education_score) || 0))
  const stability = Math.max(0, Math.min(100, Number(row.stability_score) || 0))
  if (skill + experience + education + stability === 0) {
    return deriveResumeDimsFromOverall(overall)
  }
  return { skill, experience, education, stability }
}

function mapScreeningRow(r: {
  id: number | string
  job_code: string
  candidate_name: string
  matched_job_title: string | null
  match_score: number
  skill_score?: number | null
  experience_score?: number | null
  education_score?: number | null
  stability_score?: number | null
  status: string
  pipeline_stage?: string | null
  interview_overall_score?: unknown
  interview_passed?: unknown
  interview_report_updated_at?: unknown
  report_summary: string | null
  created_at: string | Date
}): Resume {
  const created = r.created_at
  const uploadTime =
    created instanceof Date
      ? created.toLocaleString('zh-CN', { hour12: false })
      : String(created || '')
  const overall = Math.max(0, Math.min(100, Number(r.match_score) || 0))
  const d = dimsFromScreeningDbRow(r, overall)
  const { flowStage, aiConclusion } = deriveScreeningFlowLabels(r as unknown as Record<string, unknown>)
  return {
    id: String(r.id),
    name: String(r.candidate_name || '候选人'),
    job: String(r.matched_job_title || r.job_code || ''),
    jobCode: String(r.job_code || ''),
    matchScore: overall,
    skillScore: d.skill,
    experienceScore: d.experience,
    educationScore: d.education,
    stabilityScore: d.stability,
    status: aiConclusion,
    flowStage,
    uploadTime,
    reportSummary: String(r.report_summary || '')
  }
}

function ResumeScreeningView({
  currentRole,
  authProfile
}: {
  currentRole: Role;
  authProfile: AdminLoginProfile | null;
}) {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [sessRev, setSessRev] = useState(0);
  useEffect(() => subscribeAdminSession(() => setSessRev((n) => n + 1)), []);
  const apiBase = resolveMiniappApiBase();
  const hasToken = hasAdminApiCredentials();
  void sessRev;
  const [inviteJobs, setInviteJobs] = useState<{ job_code: string; title: string; department: string }[]>([]);
  const [inviteJobsLoading, setInviteJobsLoading] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState<string | null>(null);
  const [inviteBanner, setInviteBanner] = useState('');
  const [lastInvite, setLastInvite] = useState<{ inviteCode: string; jobCode: string } | null>(null);
  const [selectedJobCode, setSelectedJobCode] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadHint, setUploadHint] = useState('');
  const [screenListError, setScreenListError] = useState('');
  const [reportResume, setReportResume] = useState<Resume | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { codes: recruiterJobCodes, loading: recruiterScopeLoading } = useRecruiterScopedJobCodes(
    currentRole,
    authProfile
  );
  const isRecruiter = currentRole === 'recruiter';
  const recruiterCodeSet = useMemo(() => new Set(recruiterJobCodes), [recruiterJobCodes]);

  const loadScreenings = useCallback(() => {
    if (!apiBase || !hasToken) {
      setResumes([]);
      setScreenListError('');
      return;
    }
    setScreenListError('');
    void miniappApiFetch('/api/admin/resume-screenings')
      .then(async (r) => {
        const j = (await r.json()) as { data?: unknown[]; message?: string }
        if (!r.ok) throw new Error(j.message || 'load failed');
        const rows = (j.data || []) as Array<{
          id: number | string
          job_code: string
          candidate_name: string
          matched_job_title: string | null
          match_score: number
          skill_score?: number | null
          experience_score?: number | null
          education_score?: number | null
          stability_score?: number | null
          status: string
          pipeline_stage?: string | null
          interview_overall_score?: unknown
          interview_passed?: unknown
          interview_report_updated_at?: unknown
          report_summary: string | null
          created_at: string | Date
        }>
        const mapped = rows.map((row) => mapScreeningRow(row));
        setResumes(
          isRecruiter ? mapped.filter((x) => x.jobCode && recruiterCodeSet.has(String(x.jobCode))) : mapped
        );
      })
      .catch(() => {
        setResumes([]);
        setScreenListError('筛查记录暂时无法加载，请稍后重试或联系管理员检查系统是否已升级、网络是否正常。');
      });
  }, [apiBase, hasToken, isRecruiter, recruiterCodeSet, sessRev]);

  useEffect(() => {
    loadScreenings();
  }, [loadScreenings]);

  useEffect(() => {
    if (!apiBase || !hasToken) {
      setInviteBanner('请先完成管理端登录；若已登录仍提示此项，请联系管理员确认招聘服务是否已开启。');
      return;
    }
    setInviteJobsLoading(true);
    setInviteBanner('');
    miniappApiFetch('/api/admin/jobs')
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          data?: { job_code: string; title: string; department: string }[];
          message?: string;
        };
        if (!r.ok) {
          const hint =
            j.message ||
            (r.status === 401
              ? '未授权，请重新登录；若仍失败请联系管理员。'
              : r.status === 503
                ? '登录服务暂不可用，请稍后再试或联系管理员。'
                : `服务异常（${r.status}），请稍后再试或联系管理员。`);
          throw new Error(hint);
        }
        const all = j.data || [];
        const scoped = isRecruiter ? all.filter((x) => recruiterCodeSet.has(String(x.job_code))) : all;
        setInviteJobs(scoped);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        const isNet =
          msg === 'Failed to fetch' || msg === 'Load failed' || msg.includes('NetworkError');
        setInviteBanner(
          isNet
            ? '无法连接到招聘服务，请检查网络或联系管理员确认后台是否在线。'
            : `加载岗位列表失败：${msg || '请稍后重试或联系管理员。'}`
        );
        setInviteJobs([]);
      })
      .finally(() => setInviteJobsLoading(false));
  }, [apiBase, hasToken, isRecruiter, recruiterCodeSet, sessRev]);

  useEffect(() => {
    if (inviteJobs.length === 0) return;
    setSelectedJobCode((prev) => {
      if (prev && inviteJobs.some((j) => j.job_code === prev)) return prev;
      return inviteJobs[0].job_code;
    });
  }, [inviteJobs]);

  const handleMiniappInvite = async (jobCode: string, screeningId?: string) => {
    setLastInvite(null);
    setCreatingInvite(jobCode);
    try {
      const recruiterCode = getAdminLoginProfile()?.username || '';
      const body: Record<string, unknown> = { jobCode, expiresInDays: 7, recruiterCode };
      if (screeningId && String(screeningId).trim()) {
        const sid = Number(screeningId);
        if (Number.isFinite(sid) && sid > 0) body.screeningId = sid;
      }
      const r = await miniappApiFetch('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const j = (await r.json()) as { data?: { inviteCode: string; jobCode: string }; message?: string };
      if (!r.ok) throw new Error(j.message || `发起失败 HTTP ${r.status}`);
      if (j.data?.inviteCode) {
        setLastInvite({ inviteCode: j.data.inviteCode, jobCode: j.data.jobCode });
        setInviteBanner('');
        loadScreenings();
      }
    } catch (e) {
      setInviteBanner(e instanceof Error ? e.message : '发起面试失败');
    } finally {
      setCreatingInvite(null);
    }
  };

  const copyInviteCode = (code: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code);
    }
  };

  const handleInviteFromResume = (resume: Resume) => {
    if (resume.jobCode) {
      const byCode = inviteJobs.find((j) => j.job_code === resume.jobCode);
      if (byCode) {
        void handleMiniappInvite(byCode.job_code, resume.id);
        return;
      }
    }
    const name = (resume.job || '').trim();
    if (!name) {
      setInviteBanner('该简历未标注匹配岗位，请联系管理员补充岗位关联后再发起面试。');
      return;
    }
    const matched =
      inviteJobs.find((j) => j.job_code === name) ||
      inviteJobs.find((j) => j.title === name) ||
      inviteJobs.find((j) => name.includes(j.title) || j.title.includes(name));
    if (!matched) {
      setInviteBanner(`未在可操作岗位中找到与「${name}」对应的岗位，请联系管理员确认岗位分配。`);
      return;
    }
    void handleMiniappInvite(matched.job_code, resume.id);
  };

  const runUpload = (file: File | null) => {
    if (!file || !apiBase || !hasToken) return;
    if (!selectedJobCode) {
      setUploadHint('请先选择目标岗位。');
      return;
    }
    setUploadHint('');
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('jobCode', selectedJobCode);
    void miniappApiFetch('/api/admin/resume-screen', { method: 'POST', body: fd })
      .then(async (r) => {
        const j = (await r.json()) as { message?: string }
        if (!r.ok) throw new Error(j.message || 'upload failed');
        loadScreenings();
        setUploadHint('解析与打分已完成，已加入下方列表。');
      })
      .catch((e: unknown) => {
        setUploadHint(e instanceof Error ? e.message : '上传或筛查失败');
      })
      .finally(() => setUploading(false));
  };

  return (
    <div className="space-y-6">
      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-start gap-3">
        <Send className="w-5 h-5 text-emerald-600 mt-0.5" />
        <div>
          <h4 className="font-bold text-emerald-900">标准招聘流程（与列表「流程阶段」一致）</h4>
          <ol className="text-sm text-emerald-900/95 mt-2 space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>
              <span className="font-medium text-emerald-950">AI 筛查简历</span>：上传后生成匹配分与 AI 结论文案（状态里的「AI分析完成」等指本步）。
            </li>
            <li>
              <span className="font-medium text-emerald-950">发起面试邀请</span>：在卡片点「发起面试」会生成邀请码，并把这行筛查记为「已发面试邀请」（请从卡片发起以便系统关联）。
            </li>
            <li>
              <span className="font-medium text-emerald-950">候选人面试</span>：对方用邀请码进入小程序，完成答题/面试；姓名需与简历筛查中的姓名一致，便于合并报告。
            </li>
            <li>
              <span className="font-medium text-emerald-950">面试报告</span>：提交后写入报告，列表进入「初面通过/待提升」等，综合分以面试分为准（初面管理同逻辑）。
            </li>
          </ol>
          <p className="text-sm text-emerald-800 mt-3 leading-relaxed border-t border-emerald-200/80 pt-3">
            <span className="font-semibold text-emerald-950">候选人无需事先注册。</span>
            将 INV 邀请码发给对方后，其在「欢迎参加面试」登录页填写真实姓名与邀请码即可进入准备页。
          </p>
        </div>
      </div>
      {inviteBanner ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">{inviteBanner}</div>
      ) : null}
      {isRecruiter && !recruiterScopeLoading && recruiterJobCodes.length === 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          当前账号未分配可操作岗位，请联系管理员在岗位分配中添加您的岗位负责人配置。
        </div>
      ) : null}
      <div className="space-y-6">
        {/* Upload Area */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col">
            <h3 className="font-bold text-slate-900 mb-4">上传简历进行 AI 筛查</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">目标匹配岗位</label>
              <select
                value={selectedJobCode}
                onChange={(e) => setSelectedJobCode(e.target.value)}
                disabled={!inviteJobs.length || inviteJobsLoading || recruiterScopeLoading}
                className="w-full border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none text-sm disabled:bg-slate-100"
              >
                {inviteJobs.length === 0 ? (
                  <option value="">暂无可用岗位，请联系管理员在系统中维护岗位信息</option>
                ) : (
                  inviteJobs.map((j) => (
                    <option key={j.job_code} value={j.job_code}>
                      {j.title} ({j.job_code})
                    </option>
                  ))
                )}
              </select>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                runUpload(f || null);
              }}
            />
            {uploadHint ? (
              <p
                className={`text-xs mb-3 ${
                  /失败|未创建|请先|未能|不支持|错误/i.test(uploadHint) ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {uploadHint}
              </p>
            ) : null}
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (uploading) return;
                const f = e.dataTransfer.files?.[0];
                runUpload(f || null);
              }}
              className={`min-h-[220px] border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center p-8 text-center transition-colors group ${
                uploading ? 'opacity-60 cursor-wait' : 'hover:bg-slate-50 hover:border-indigo-400 cursor-pointer'
              }`}
            >
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-8 h-8 text-indigo-500" />
              </div>
              <p className="font-medium text-slate-700 mb-1">{uploading ? '正在解析与打分…' : '点击或拖拽简历文件到此处'}</p>
              <p className="text-xs text-slate-500">支持 PDF、DOCX、TXT；旧版 .doc 请另存为 DOCX 后再上传。</p>
            </div>
          </div>
        </div>

        {/* Results Area */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">AI 筛查结果</h3>
              <span className="text-sm text-slate-500">共解析 {resumes.length} 份简历</span>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {lastInvite ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                  <p className="text-sm text-indigo-900 mb-2 leading-relaxed">
                    最近生成的邀请码（请发给候选人）
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <code className="text-lg font-mono bg-white px-3 py-2 rounded border border-indigo-100">
                      {lastInvite.inviteCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyInviteCode(lastInvite.inviteCode)}
                      className="text-sm text-indigo-700 hover:underline"
                    >
                      复制
                    </button>
                    <span className="text-indigo-700/80 text-sm">岗位 {lastInvite.jobCode}</span>
                  </div>
                </div>
              ) : null}
              {screenListError ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">{screenListError}</div>
              ) : null}
              {!apiBase || !hasToken ? (
                <p className="text-sm text-slate-500">
                  请先完成管理端登录；登录成功后，此处将展示已上传简历的 AI 筛查记录。
                </p>
              ) : null}
              {apiBase && hasToken && resumes.length === 0 ? (
                <p className="text-sm text-slate-500">
                  暂无筛查记录。请从左侧上传简历；若长期无数据，请联系管理员确认系统是否正常。
                </p>
              ) : null}
              {resumes.map(resume => (
                <div key={resume.id} className="border border-slate-200 rounded-lg p-4 flex items-center gap-6 hover:border-indigo-300 transition-colors">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <FileText className="w-6 h-6 text-slate-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h4 className="font-bold text-slate-900 text-lg">{resume.name}</h4>
                      {resume.flowStage ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800">
                          {resume.flowStage}
                        </span>
                      ) : null}
                      <span className="text-xs text-slate-500">匹配岗位: {resume.job}</span>
                    </div>
                    <div className="text-sm text-slate-500">上传时间: {resume.uploadTime}</div>
                    <div className="text-[11px] text-slate-400 mt-1">AI 简历结论：{resume.status}</div>
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
                    <button
                      type="button"
                      onClick={() => setReportResume(resume)}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-sm font-medium rounded hover:bg-indigo-100"
                    >
                      查看报告
                    </button>
                    {resume.matchScore >= 60 && (
                      <button
                        type="button"
                        onClick={() => handleInviteFromResume(resume)}
                        disabled={!apiBase || !hasToken || Boolean(creatingInvite)}
                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-sm font-medium rounded hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        发起面试
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {reportResume ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-modal-title"
            onClick={() => setReportResume(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[min(80vh,560px)] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
                <div>
                  <h3 id="report-modal-title" className="text-lg font-bold text-slate-900">筛查报告 · {reportResume.name}</h3>
                  <p className="text-sm text-slate-500 mt-0.5">{reportResume.job} · {reportResume.uploadTime}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReportResume(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="关闭"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <p className="text-xs font-medium text-slate-500 mb-1">
                  {reportResume.flowStage ? (
                    <span className="text-indigo-600 mr-1">流程：{reportResume.flowStage} · </span>
                  ) : null}
                  简历匹配 {reportResume.matchScore} 分 · AI 结论 {reportResume.status}
                </p>
                <p className="text-xs text-slate-500 mb-3">
                  维度：技能 {reportResume.skillScore ?? '—'} / 经验 {reportResume.experienceScore ?? '—'} / 学历{' '}
                  {reportResume.educationScore ?? '—'} / 稳定 {reportResume.stabilityScore ?? '—'}
                </p>
                <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {reportResume.reportSummary?.trim() || '暂无报告正文。'}
                </div>
              </div>
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-xl flex justify-end">
                <button
                  type="button"
                  onClick={() => setReportResume(null)}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ApplicationManagementView({
  currentRole,
  authProfile
}: {
  currentRole: Role;
  authProfile: AdminLoginProfile | null;
}) {
  const [rows, setRows] = useState<Array<{
    id: string
    candidateName: string
    jobCode: string
    jobTitle: string
    /** 列表主分数：有面试报告用面试综合分，否则用简历 match_score */
    score: number
    resumeMatchScore: number
    hasInterviewReport: boolean
    skill: number
    experience: number
    education: number
    stability: number
    /** 流程阶段：简历筛查完成 / 已发邀请 / 初面通过 … */
    status: string
    /** AI 对简历的结论文案，与流程阶段分列展示 */
    aiConclusion: string
    /** 面试进度说明（邀请/报告/会话等） */
    interviewSituation: string
    summary: string
  }>>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [reportLoadingId, setReportLoadingId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [scoreFilter, setScoreFilter] = useState<'all' | 'high' | 'mid' | 'low'>('all')
  const [reportModal, setReportModal] = useState<null | {
    candidateName: string
    jobCode: string
    score: number
    passed: boolean
    overallFeedback: string
    dimensionScores: Record<string, number>
    suggestions: string[]
    riskPoints: string[]
    behaviorSignals: Record<string, unknown>
    qa: Array<{ questionId?: string; question?: string; answer?: string }>
    updatedAt: string
  }>(null)
  const { codes: recruiterJobCodes, loading: recruiterScopeLoading } = useRecruiterScopedJobCodes(
    currentRole,
    authProfile
  )
  const isRecruiter = currentRole === 'recruiter'
  const recruiterCodeSet = useMemo(() => new Set(recruiterJobCodes), [recruiterJobCodes])

  const loadRows = useCallback(() => {
    setLoading(true)
    setErr('')
    void miniappApiFetch('/api/admin/resume-screenings')
      .then(async (r) => {
        const j = (await r.json()) as { data?: unknown[]; message?: string }
        if (!r.ok) throw new Error(j.message || `加载失败 ${r.status}`)
        const data = Array.isArray(j.data) ? j.data : []
        const mapped = data.map((x) => {
            const row = x as Record<string, unknown>
            const resumeMatch = Math.max(0, Math.min(100, Number(row.match_score) || 0))
            const d = dimsFromScreeningDbRow(
              {
                skill_score: row.skill_score as number | null | undefined,
                experience_score: row.experience_score as number | null | undefined,
                education_score: row.education_score as number | null | undefined,
                stability_score: row.stability_score as number | null | undefined
              },
              resumeMatch
            )
            const ivRaw = row.interview_overall_score
            const updatedAt = row.interview_report_updated_at
            const hasUpdated =
              updatedAt !== null && updatedAt !== undefined && String(updatedAt).trim() !== ''
            const ivParsed =
              ivRaw !== null && ivRaw !== undefined && String(ivRaw).trim() !== ''
                ? Math.max(0, Math.min(100, Number(ivRaw) || 0))
                : null
            const hasInterviewReport = hasUpdated || ivParsed !== null
            const { flowStage, aiConclusion } = deriveScreeningFlowLabels(row as Record<string, unknown>)
            return {
              id: String(row.id ?? ''),
              candidateName: String(row.candidate_name ?? '候选人'),
              jobCode: String(row.job_code ?? ''),
              jobTitle: String(row.matched_job_title ?? row.job_code ?? ''),
              score: hasInterviewReport ? (ivParsed !== null ? ivParsed : 0) : resumeMatch,
              resumeMatchScore: resumeMatch,
              hasInterviewReport,
              skill: d.skill,
              experience: d.experience,
              education: d.education,
              stability: d.stability,
              status: flowStage,
              aiConclusion,
              interviewSituation: deriveInterviewSituation(row as Record<string, unknown>, hasInterviewReport),
              summary: String(row.report_summary ?? '')
            }
          })
        setRows(
          isRecruiter ? mapped.filter((x) => x.jobCode && recruiterCodeSet.has(String(x.jobCode))) : mapped
        )
      })
      .catch((e: unknown) => {
        setRows([])
        setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => setLoading(false))
  }, [isRecruiter, recruiterCodeSet])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  const filteredRows = rows.filter((row) => {
    const kw = keyword.trim().toLowerCase()
    if (kw) {
      const hit =
        row.candidateName.toLowerCase().includes(kw) ||
        row.jobTitle.toLowerCase().includes(kw) ||
        row.jobCode.toLowerCase().includes(kw)
      if (!hit) return false
    }
    if (statusFilter && row.status !== statusFilter) return false
    if (scoreFilter === 'high' && row.score < 80) return false
    if (scoreFilter === 'mid' && (row.score < 60 || row.score >= 80)) return false
    if (scoreFilter === 'low' && row.score >= 60) return false
    return true
  })

  const statusOptions = Array.from(new Set(rows.map((x) => x.status).filter(Boolean)))
  const highCount = rows.filter((x) => x.score >= 80).length
  const midCount = rows.filter((x) => x.score >= 60 && x.score < 80).length
  const lowCount = rows.filter((x) => x.score < 60).length

  const handleOpenInterviewReport = async (row: { id: string; candidateName: string; jobCode: string }) => {
    setReportLoadingId(row.id)
    try {
      const r = await miniappApiFetch(`/api/admin/interview-report?screeningId=${encodeURIComponent(row.id)}`)
      const j = (await r.json()) as { data?: Record<string, unknown>; message?: string }
      if (!r.ok || !j.data) throw new Error(j.message || `加载失败 ${r.status}`)
      const d = j.data
      setReportModal({
        candidateName: row.candidateName,
        jobCode: row.jobCode,
        score: Math.max(0, Math.min(100, Number(d.score) || 0)),
        passed: Boolean(d.passed),
        overallFeedback: String(d.overallFeedback || ''),
        dimensionScores: (d.dimensionScores as Record<string, number>) || {},
        suggestions: Array.isArray(d.suggestions) ? d.suggestions.map((x) => String(x)) : [],
        riskPoints: Array.isArray(d.riskPoints) ? d.riskPoints.map((x) => String(x)) : [],
        behaviorSignals: (d.behaviorSignals as Record<string, unknown>) || {},
        qa: Array.isArray(d.qa) ? (d.qa as Array<{ questionId?: string; question?: string; answer?: string }>) : [],
        updatedAt: String(d.updatedAt || '')
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '加载面试报告失败')
    } finally {
      setReportLoadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {isRecruiter && !recruiterScopeLoading && recruiterJobCodes.length === 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          当前账号未分配可查看岗位，请联系管理员在岗位分配中添加您的岗位负责人配置。
        </div>
      ) : null}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50 space-y-4">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-slate-900">初面管理</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
                一条记录对应一次简历筛查。<span className="font-medium text-slate-600">流程阶段</span>随漏斗推进：筛查完成 → 从筛查页「发起面试」后为已发邀请 → 候选人完成面试并生成报告后为初面结果。
                面试报告按岗位码 + 姓名关联；综合分有报告时显示面试分，否则为简历匹配分。「AI 简历结论」列始终为筛查模型对简历的文案，与初面结果分列展示。
                「面试情况」根据邀请标记、报告与会话表汇总为可读说明（姓名不一致时可能无法关联报告）。
              </p>
            </div>
            <button
              type="button"
              onClick={loadRows}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              刷新
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
              <p className="text-xs text-emerald-700">列表综合分 80+</p>
              <p className="text-lg font-bold text-emerald-900">{highCount}</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-700">列表综合分 60–79</p>
              <p className="text-lg font-bold text-amber-900">{midCount}</p>
            </div>
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
              <p className="text-xs text-rose-700">列表综合分 &lt;60</p>
              <p className="text-lg font-bold text-rose-900">{lowCount}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">当前筛选结果</p>
              <p className="text-lg font-bold text-slate-900">{filteredRows.length}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索候选人/岗位/编码"
              className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">全部状态</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={scoreFilter}
              onChange={(e) => setScoreFilter(e.target.value as 'all' | 'high' | 'mid' | 'low')}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">全部分段</option>
              <option value="high">综合分 80+</option>
              <option value="mid">综合分 60–79</option>
              <option value="low">综合分 &lt;60</option>
            </select>
          </div>
        </div>
        {err ? <div className="px-6 py-3 text-sm text-red-600 border-b border-slate-100">{err}</div> : null}
        <table className="w-full text-left text-sm">
          <thead className="bg-white border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">候选人</th>
              <th className="px-6 py-4 font-medium">岗位</th>
              <th className="px-6 py-4 font-medium">综合分</th>
              <th className="px-6 py-4 font-medium">简历维度</th>
              <th className="px-6 py-4 font-medium w-1/3">AI 简历结论</th>
              <th className="px-6 py-4 font-medium">流程阶段</th>
              <th className="px-6 py-4 font-medium min-w-[200px]">面试情况</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td className="px-6 py-8 text-slate-500" colSpan={8}>加载中...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td className="px-6 py-8 text-slate-500" colSpan={8}>暂无数据，请先在简历筛查上传简历</td></tr>
            ) : (
              filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900">{row.candidateName}</td>
                    <td className="px-6 py-4 text-slate-600">{row.jobTitle}（{row.jobCode}）</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-0.5 items-start">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">
                          <BrainCircuit className="w-3.5 h-3.5" /> {row.score}
                          <span className="text-[10px] font-normal text-slate-500">
                            {row.hasInterviewReport ? '面试' : '简历'}
                          </span>
                        </span>
                        {row.hasInterviewReport ? (
                          <span className="text-[11px] text-slate-400">简历匹配 {row.resumeMatchScore}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600 leading-relaxed">
                      技能 {row.skill} / 经验 {row.experience} / 学历 {row.education} / 稳定 {row.stability}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs leading-relaxed">{row.summary || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            row.status === '初面通过'
                              ? 'bg-emerald-100 text-emerald-800'
                              : row.status === '初面待提升'
                                ? 'bg-rose-100 text-rose-800'
                                : row.status === '初面已完成' || row.status === '面试报告已出具'
                                  ? 'bg-violet-100 text-violet-800'
                                  : row.status === '已发面试邀请'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          {row.status}
                        </span>
                        <p className="text-[11px] text-slate-400 leading-snug">简历 AI：{row.aiConclusion}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600 leading-relaxed max-w-xs">
                      {row.interviewSituation}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        disabled={Boolean(reportLoadingId) || !row.hasInterviewReport}
                        onClick={() => {
                          if (!row.hasInterviewReport) return
                          void handleOpenInterviewReport(row)
                        }}
                        title={row.hasInterviewReport ? '查看面试报告详情' : '候选人尚未产生可关联的面试报告'}
                        className={`text-sm font-medium ${
                          row.hasInterviewReport
                            ? 'text-indigo-600 hover:text-indigo-800 disabled:opacity-50'
                            : 'text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {reportLoadingId === row.id && row.hasInterviewReport
                          ? '加载中…'
                          : row.hasInterviewReport
                            ? '面试报告'
                            : '暂无报告'}
                      </button>
                    </td>
                  </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <AnimatePresence>
        {reportModal ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
            role="dialog"
            aria-modal="true"
            onClick={() => setReportModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[84vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">面试报告 · {reportModal.candidateName}</h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    岗位 {reportModal.jobCode} · 更新时间 {reportModal.updatedAt || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReportModal(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="关闭"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                  <p className="text-sm text-slate-600">
                    综合评分 <span className="font-bold text-slate-900">{reportModal.score}</span> · 结果{' '}
                    <span className={reportModal.passed ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                      {reportModal.passed ? '通过' : '待提升'}
                    </span>
                  </p>
                  <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{reportModal.overallFeedback || '暂无综合结论'}</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(reportModal.dimensionScores || {}).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                      <div className="text-slate-500">{k}</div>
                      <div className="font-semibold text-slate-900">{Number(v) || 0}</div>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800 mb-2">改进建议</h4>
                    <ul className="text-sm text-slate-700 space-y-1">
                      {(reportModal.suggestions || []).length ? reportModal.suggestions.map((x, idx) => <li key={idx}>- {x}</li>) : <li>- 暂无</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800 mb-2">风险点</h4>
                    <ul className="text-sm text-slate-700 space-y-1">
                      {(reportModal.riskPoints || []).length ? reportModal.riskPoints.map((x, idx) => <li key={idx}>- {x}</li>) : <li>- 暂无</li>}
                    </ul>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800 mb-2">答题明细</h4>
                  <div className="space-y-2">
                    {(reportModal.qa || []).length ? (
                      reportModal.qa.map((item, idx) => (
                        <div key={`${item.questionId || idx}`} className="border border-slate-200 rounded-lg p-3">
                          <p className="text-sm font-medium text-slate-900">Q{idx + 1}：{String(item.question || '—')}</p>
                          <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">{String(item.answer || '（无作答）')}</p>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">暂无答题明细</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-xl flex justify-end">
                <button
                  type="button"
                  onClick={() => setReportModal(null)}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// --- System Management Views ---

async function adminFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'message' in data && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

const systemFieldClass =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none';

function SystemCrudModal({
  open,
  title,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center gap-4">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none px-1"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 flex-wrap">{footer}</div>
      </div>
    </div>,
    document.body
  );
}

function SystemDeptView() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<
    null | { mode: 'create' | 'edit' | 'child'; parent?: Dept; record?: Dept }
  >(null);
  const [saving, setSaving] = useState(false);
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formLevel, setFormLevel] = useState('0');
  const [formManager, setFormManager] = useState('');
  const [formCount, setFormCount] = useState('0');

  const openCreate = () => {
    setDialog({ mode: 'create' });
    setFormId('');
    setFormName('');
    setFormLevel('0');
    setFormManager('');
    setFormCount('0');
  };

  const openChild = (parent: Dept) => {
    setDialog({ mode: 'child', parent });
    setFormId('');
    setFormName('');
    setFormLevel(String((Number(parent.level) || 0) + 1));
    setFormManager('');
    setFormCount('0');
  };

  const openEdit = (d: Dept) => {
    setDialog({ mode: 'edit', record: d });
    setFormId(d.id);
    setFormName(d.name);
    setFormLevel(String(Number(d.level) || 0));
    setFormManager(d.manager || '');
    setFormCount(String(Number(d.count) || 0));
  };

  const closeDialog = () => {
    if (saving) return;
    setDialog(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await adminFetchJson<Dept[]>('/api/depts');
      const sorted = [...rows].sort((a, b) => {
        const la = Number(a.level) || 0;
        const lb = Number(b.level) || 0;
        if (la !== lb) return la - lb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      setDepts(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setDepts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitDept = async () => {
    if (!dialog) return;
    const name = formName.trim();
    if (!name) {
      setError('请填写部门名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        id: formId.trim() || undefined,
        name,
        level: Number(formLevel) || 0,
        manager: formManager.trim() || '-',
        count: Number(formCount) || 0
      };
      if (dialog.mode === 'edit' && dialog.record) {
        await adminFetchJson(`/api/depts/${encodeURIComponent(dialog.record.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: payload.name,
            level: payload.level,
            manager: payload.manager,
            count: payload.count
          })
        });
      } else {
        await adminFetchJson<{ id: string }>('/api/depts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      setDialog(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteDept = async (d: Dept) => {
    if (!window.confirm(`确定删除部门「${d.name}」？`)) return;
    setError(null);
    try {
      await adminFetchJson(`/api/depts/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const filtered = depts.filter((d) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return String(d.name || '').toLowerCase().includes(s) || String(d.manager || '').toLowerCase().includes(s);
  });

  const dialogTitle =
    dialog?.mode === 'edit' ? '编辑部门' : dialog?.mode === 'child' ? '添加子部门' : '新增部门';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索部门或负责人…"
            className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 max-w-full focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> 新增部门
        </button>
      </div>
      {error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="text-indigo-600 font-medium shrink-0">
            重试
          </button>
        </div>
      ) : null}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">{q.trim() ? '无匹配部门' : '暂无部门数据'}</div>
        ) : (
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
              {filtered.map((dept) => {
                const lv = Number(dept.level) || 0;
                return (
                  <tr key={dept.id} className="hover:bg-slate-50 transition-colors">
                    <td
                      className="px-6 py-4 font-medium text-slate-900 flex items-center gap-2"
                      style={{ paddingLeft: `${lv * 2 + 1.5}rem` }}
                    >
                      {lv > 0 && <span className="w-4 h-px bg-slate-300 inline-block mr-1"></span>}
                      <Network className="w-4 h-4 text-indigo-400 shrink-0" />
                      {dept.name}
                    </td>
                    <td className="px-6 py-4 text-slate-600">{dept.manager}</td>
                    <td className="px-6 py-4 text-slate-600">{dept.count} 人</td>
                    <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openChild(dept)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                      >
                        子部门
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(dept)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteDept(dept)}
                        className="text-red-600 hover:text-red-800 font-medium text-xs"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <SystemCrudModal
        open={Boolean(dialog)}
        title={dialogTitle}
        onClose={closeDialog}
        footer={
          <>
            <button
              type="button"
              onClick={closeDialog}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitDept()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {dialog?.mode !== 'edit' ? (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">部门 ID（可选，留空自动生成）</label>
            <input className={systemFieldClass} value={formId} onChange={(e) => setFormId(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">部门名称</label>
          <input className={systemFieldClass} value={formName} onChange={(e) => setFormName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">层级（0 为顶级）</label>
            <input
              type="number"
              min={0}
              className={systemFieldClass}
              value={formLevel}
              onChange={(e) => setFormLevel(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">成员数量</label>
            <input
              type="number"
              min={0}
              className={systemFieldClass}
              value={formCount}
              onChange={(e) => setFormCount(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">负责人</label>
          <input className={systemFieldClass} value={formManager} onChange={(e) => setFormManager(e.target.value)} />
        </div>
      </SystemCrudModal>
    </div>
  );
}

function SystemUserView() {
  const [users, setUsers] = useState<User[]>([]);
  const [deptNames, setDeptNames] = useState<string[]>([]);
  const [roleOptions, setRoleOptions] = useState<SysRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [userDialog, setUserDialog] = useState<null | { mode: 'create' | 'edit'; user?: User }>(null);
  const [saving, setSaving] = useState(false);
  const [ufId, setUfId] = useState('');
  const [ufName, setUfName] = useState('');
  const [ufUsername, setUfUsername] = useState('');
  const [ufDept, setUfDept] = useState('');
  const [ufRole, setUfRole] = useState('');
  const [ufStatus, setUfStatus] = useState<'正常' | '停用'>('正常');
  const [ufPassword, setUfPassword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userRows, deptRows, roleRows] = await Promise.all([
        adminFetchJson<User[]>('/api/users'),
        adminFetchJson<Dept[]>('/api/depts'),
        adminFetchJson<Array<Record<string, unknown>>>('/api/roles')
      ]);
      setUsers(userRows);
      const names = [...new Set(deptRows.map((d) => String(d.name || '')).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'zh-CN')
      );
      setDeptNames(names);
      setRoleOptions(
        roleRows.map((r) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? ''),
          desc: String(r.desc ?? ''),
          users: Number(r.users) || 0
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setUsers([]);
      setDeptNames([]);
      setRoleOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openUserCreate = () => {
    setUserDialog({ mode: 'create' });
    setUfId('');
    setUfName('');
    setUfUsername('');
    setUfDept(deptNames[0] || '');
    setUfRole(roleOptions[0]?.name || '招聘人员');
    setUfStatus('正常');
    setUfPassword('');
  };

  const openUserEdit = (u: User) => {
    setUserDialog({ mode: 'edit', user: u });
    setUfId(u.id);
    setUfName(u.name);
    setUfUsername(u.username);
    setUfDept(u.dept || '');
    setUfRole(u.role || '');
    setUfStatus(u.status === '停用' ? '停用' : '正常');
    setUfPassword('');
  };

  const closeUserDialog = () => {
    if (saving) return;
    setUserDialog(null);
  };

  const submitUser = async () => {
    if (!userDialog) return;
    const name = ufName.trim();
    const username = ufUsername.trim();
    const dept = ufDept.trim() || '-';
    const role = ufRole.trim() || '招聘人员';
    if (!name || !username) {
      setError('请填写姓名与登录账号');
      return;
    }
    if (userDialog.mode === 'create' && !ufPassword.trim()) {
      setError('请设置初始密码');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (userDialog.mode === 'edit' && userDialog.user) {
        const body: Record<string, unknown> = {
          name,
          username,
          dept,
          role,
          status: ufStatus
        };
        if (ufPassword.trim()) body.password = ufPassword.trim();
        await adminFetchJson(`/api/users/${encodeURIComponent(userDialog.user.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        await adminFetchJson<{ id: string }>('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: ufId.trim() || undefined,
            name,
            username,
            dept,
            role,
            status: ufStatus,
            password: ufPassword.trim()
          })
        });
      }
      setUserDialog(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (u: User) => {
    if (!window.confirm(`确定删除用户「${u.name}」（${u.username}）？`)) return;
    setError(null);
    try {
      await adminFetchJson(`/api/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const toggleStatus = async (user: User) => {
    const next = user.status === '停用' ? '正常' : '停用';
    setUpdatingId(user.id);
    setError(null);
    try {
      await adminFetchJson<{ ok: boolean }>(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: next } : u)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = users.filter((u) => {
    if (deptFilter && String(u.dept || '') !== deptFilter) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (
      String(u.name || '').toLowerCase().includes(s) ||
      String(u.username || '').toLowerCase().includes(s) ||
      String(u.dept || '').toLowerCase().includes(s) ||
      String(u.role || '').toLowerCase().includes(s)
    );
  });

  const initial = (name: string) => {
    const t = String(name || '').trim();
    return t ? t[0] : '?';
  };

  const datalistId = 'system-user-dept-suggest';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="flex gap-4 flex-wrap">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索用户名、姓名、部门…"
              className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-64 max-w-full focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none text-slate-600 min-w-[10rem]"
          >
            <option value="">全部部门</option>
            {deptNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={openUserCreate}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> 新增用户
        </button>
      </div>
      {error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="text-indigo-600 font-medium shrink-0">
            重试
          </button>
        </div>
      ) : null}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">{q.trim() || deptFilter ? '无匹配用户' : '暂无用户数据'}</div>
        ) : (
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
              {filtered.map((user) => {
                const busy = updatingId === user.id;
                const active = user.status === '正常';
                return (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                        {initial(user.name)}
                      </div>
                      {user.name}
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-mono text-xs">{user.username}</td>
                    <td className="px-6 py-4 text-slate-600">{user.dept}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-md border border-indigo-100">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {active ? (
                        <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" /> 正常
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                          <span className="w-2 h-2 rounded-full bg-slate-400" /> 停用
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openUserEdit(user)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleStatus(user)}
                        className={
                          active
                            ? 'text-amber-700 hover:text-amber-900 font-medium text-xs disabled:opacity-50'
                            : 'text-indigo-600 hover:text-indigo-800 font-medium text-xs disabled:opacity-50'
                        }
                      >
                        {busy ? '…' : active ? '停用' : '启用'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteUser(user)}
                        className="text-red-600 hover:text-red-800 font-medium text-xs"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <SystemCrudModal
        open={Boolean(userDialog)}
        title={userDialog?.mode === 'edit' ? '编辑用户' : '新增用户'}
        onClose={closeUserDialog}
        footer={
          <>
            <button
              type="button"
              onClick={closeUserDialog}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitUser()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {userDialog?.mode === 'create' ? (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">用户 ID（可选）</label>
            <input className={systemFieldClass} value={ufId} onChange={(e) => setUfId(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">姓名</label>
          <input className={systemFieldClass} value={ufName} onChange={(e) => setUfName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">登录账号</label>
          <input
            className={systemFieldClass}
            value={ufUsername}
            onChange={(e) => setUfUsername(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">所属部门</label>
          <input
            className={systemFieldClass}
            list={datalistId}
            value={ufDept}
            onChange={(e) => setUfDept(e.target.value)}
          />
          <datalist id={datalistId}>
            {deptNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">角色</label>
          <select
            className={systemFieldClass}
            value={ufRole}
            onChange={(e) => setUfRole(e.target.value)}
          >
            {userDialog?.mode === 'edit' &&
            ufRole &&
            !roleOptions.some((r) => r.name === ufRole) ? (
              <option value={ufRole}>{ufRole}</option>
            ) : null}
            {roleOptions.length === 0 ? (
              <option value="招聘人员">招聘人员</option>
            ) : (
              roleOptions.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">状态</label>
          <select
            className={systemFieldClass}
            value={ufStatus}
            onChange={(e) => setUfStatus(e.target.value as '正常' | '停用')}
          >
            <option value="正常">正常</option>
            <option value="停用">停用</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            {userDialog?.mode === 'edit' ? '新密码（留空则不修改）' : '初始密码'}
          </label>
          <input
            type="password"
            className={systemFieldClass}
            value={ufPassword}
            onChange={(e) => setUfPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      </SystemCrudModal>
    </div>
  );
}

function SystemRoleView() {
  const [roles, setRoles] = useState<SysRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'edit'; role?: SysRole }>(null);
  const [saving, setSaving] = useState(false);
  const [rfId, setRfId] = useState('');
  const [rfName, setRfName] = useState('');
  const [rfDesc, setRfDesc] = useState('');
  const [rfUsers, setRfUsers] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await adminFetchJson<Array<Record<string, unknown>>>('/api/roles');
      const mapped: SysRole[] = rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        desc: String(r.desc ?? ''),
        users: Number(r.users) || 0
      }));
      setRoles(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setDialog({ mode: 'create' });
    setRfId('');
    setRfName('');
    setRfDesc('');
    setRfUsers('0');
  };

  const openEdit = (r: SysRole) => {
    setDialog({ mode: 'edit', role: r });
    setRfId(r.id);
    setRfName(r.name);
    setRfDesc(r.desc);
    setRfUsers(String(r.users));
  };

  const closeDialog = () => {
    if (saving) return;
    setDialog(null);
  };

  const submitRole = async () => {
    if (!dialog) return;
    const name = rfName.trim();
    if (!name) {
      setError('请填写角色名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const users = Number(rfUsers) || 0;
      if (dialog.mode === 'edit' && dialog.role) {
        await adminFetchJson(`/api/roles/${encodeURIComponent(dialog.role.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, desc: rfDesc.trim(), users })
        });
      } else {
        await adminFetchJson<{ id: string }>('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: rfId.trim() || undefined,
            name,
            desc: rfDesc.trim(),
            users
          })
        });
      }
      setDialog(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (r: SysRole) => {
    if (!window.confirm(`确定删除角色「${r.name}」？`)) return;
    setError(null);
    try {
      await adminFetchJson(`/api/roles/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const filtered = roles.filter((role) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return String(role.name || '').toLowerCase().includes(s) || String(role.desc || '').toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索角色名称或描述…"
            className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 max-w-full focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> 新增角色
        </button>
      </div>
      {error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="text-indigo-600 font-medium shrink-0">
            重试
          </button>
        </div>
      ) : null}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">{q.trim() ? '无匹配角色' : '暂无角色数据'}</div>
        ) : (
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
              {filtered.map((role) => (
                <tr key={role.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-indigo-500 shrink-0" />
                      {role.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{role.desc || '—'}</td>
                  <td className="px-6 py-4 text-slate-600">{role.users} 人</td>
                  <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEdit(role)}
                      className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteRole(role)}
                      className="text-red-600 hover:text-red-800 font-medium text-xs"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SystemCrudModal
        open={Boolean(dialog)}
        title={dialog?.mode === 'edit' ? '编辑角色' : '新增角色'}
        onClose={closeDialog}
        footer={
          <>
            <button
              type="button"
              onClick={closeDialog}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitRole()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {dialog?.mode === 'create' ? (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">角色 ID（可选）</label>
            <input className={systemFieldClass} value={rfId} onChange={(e) => setRfId(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">角色名称</label>
          <input className={systemFieldClass} value={rfName} onChange={(e) => setRfName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">描述</label>
          <textarea
            className={`${systemFieldClass} min-h-[4rem] resize-y`}
            value={rfDesc}
            onChange={(e) => setRfDesc(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">展示用关联用户数</label>
          <input
            type="number"
            min={0}
            className={systemFieldClass}
            value={rfUsers}
            onChange={(e) => setRfUsers(e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1">与真实 users 表未自动同步，仅作展示。</p>
        </div>
      </SystemCrudModal>
    </div>
  );
}

const SYSTEM_MENU_ICON_OPTIONS = [
  'Briefcase',
  'Building2',
  'Users',
  'Search',
  'FileText',
  'UserCheck',
  'Settings',
  'Menu',
  'LayoutDashboard',
  'Network',
  'Shield',
  'UserCog'
] as const;

function SystemMenuView() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'edit' | 'child'; parent?: Menu; record?: Menu }>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [mfId, setMfId] = useState('');
  const [mfName, setMfName] = useState('');
  const [mfType, setMfType] = useState('菜单');
  const [mfIcon, setMfIcon] = useState('Briefcase');
  const [mfPath, setMfPath] = useState('/');
  const [mfLevel, setMfLevel] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await adminFetchJson<Array<Record<string, unknown>>>('/api/menus');
      const mapped: Menu[] = rows.map((m) => ({
        id: String(m.id ?? ''),
        name: String(m.name ?? ''),
        type: String(m.type ?? ''),
        icon: String(m.icon ?? ''),
        path: String(m.path ?? ''),
        level: Number(m.level) || 0
      }));
      const sorted = [...mapped].sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return String(a.id).localeCompare(String(b.id), 'zh-CN');
      });
      setMenus(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setMenus([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getIcon = (name: string) => {
    switch (name) {
      case 'Briefcase':
        return <Briefcase className="w-4 h-4" />;
      case 'Building2':
        return <Building2 className="w-4 h-4" />;
      case 'Users':
        return <Users className="w-4 h-4" />;
      case 'Search':
        return <Search className="w-4 h-4" />;
      case 'FileText':
        return <FileText className="w-4 h-4" />;
      case 'UserCheck':
        return <UserCheck className="w-4 h-4" />;
      case 'Settings':
        return <Settings className="w-4 h-4" />;
      case 'Menu':
        return <MenuIcon className="w-4 h-4" />;
      case 'LayoutDashboard':
        return <LayoutDashboard className="w-4 h-4" />;
      case 'Network':
        return <Network className="w-4 h-4" />;
      case 'Shield':
        return <Shield className="w-4 h-4" />;
      case 'UserCog':
        return <UserCog className="w-4 h-4" />;
      default:
        return <MenuIcon className="w-4 h-4" />;
    }
  };

  const openCreate = () => {
    setDialog({ mode: 'create' });
    setMfId('');
    setMfName('');
    setMfType('菜单');
    setMfIcon('Briefcase');
    setMfPath('/');
    setMfLevel('0');
  };

  const openChild = (parent: Menu) => {
    setDialog({ mode: 'child', parent });
    setMfId('');
    setMfName('');
    setMfType('菜单');
    setMfIcon('Briefcase');
    setMfPath('/');
    setMfLevel(String((Number(parent.level) || 0) + 1));
  };

  const openEdit = (m: Menu) => {
    setDialog({ mode: 'edit', record: m });
    setMfId(m.id);
    setMfName(m.name);
    setMfType(m.type || '菜单');
    setMfIcon(m.icon || 'Menu');
    setMfPath(m.path || '/');
    setMfLevel(String(Number(m.level) || 0));
  };

  const closeDialog = () => {
    if (saving) return;
    setDialog(null);
  };

  const submitMenu = async () => {
    if (!dialog) return;
    const name = mfName.trim();
    if (!name) {
      setError('请填写菜单名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        id: mfId.trim() || undefined,
        name,
        type: mfType.trim() || '菜单',
        icon: mfIcon.trim() || 'Menu',
        path: mfPath.trim() || '/',
        level: Number(mfLevel) || 0
      };
      if (dialog.mode === 'edit' && dialog.record) {
        await adminFetchJson(`/api/menus/${encodeURIComponent(dialog.record.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: payload.name,
            type: payload.type,
            icon: payload.icon,
            path: payload.path,
            level: payload.level
          })
        });
      } else {
        await adminFetchJson<{ id: string }>('/api/menus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      setDialog(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteMenu = async (m: Menu) => {
    if (!window.confirm(`确定删除菜单「${m.name}」？`)) return;
    setError(null);
    try {
      await adminFetchJson(`/api/menus/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const filtered = menus.filter((menu) => {
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (
      String(menu.name || '').toLowerCase().includes(s) ||
      String(menu.path || '').toLowerCase().includes(s) ||
      String(menu.type || '').toLowerCase().includes(s)
    );
  });

  const dialogTitle =
    dialog?.mode === 'edit' ? '编辑菜单' : dialog?.mode === 'child' ? '添加下级菜单' : '新增菜单';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索菜单名称或路径…"
            className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 max-w-full focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> 新增菜单
        </button>
      </div>
      {error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="text-indigo-600 font-medium shrink-0">
            重试
          </button>
        </div>
      ) : null}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> 加载中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">{q.trim() ? '无匹配菜单' : '暂无菜单数据'}</div>
        ) : (
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
              {filtered.map((menu) => {
                const lv = menu.level;
                return (
                  <tr key={menu.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900" style={{ paddingLeft: `${lv * 2 + 1.5}rem` }}>
                      <div className="flex items-center gap-2">
                        {lv > 0 && <span className="w-4 h-px bg-slate-300 inline-block mr-1"></span>}
                        {menu.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{getIcon(menu.icon)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          menu.type === '目录' ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {menu.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-slate-500 text-xs">{menu.path}</td>
                    <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openChild(menu)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                      >
                        下级
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(menu)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteMenu(menu)}
                        className="text-red-600 hover:text-red-800 font-medium text-xs"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <SystemCrudModal
        open={Boolean(dialog)}
        title={dialogTitle}
        onClose={closeDialog}
        footer={
          <>
            <button
              type="button"
              onClick={closeDialog}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitMenu()}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {dialog?.mode !== 'edit' ? (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">菜单 ID（可选）</label>
            <input className={systemFieldClass} value={mfId} onChange={(e) => setMfId(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">菜单名称</label>
          <input className={systemFieldClass} value={mfName} onChange={(e) => setMfName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">类型</label>
            <select className={systemFieldClass} value={mfType} onChange={(e) => setMfType(e.target.value)}>
              <option value="目录">目录</option>
              <option value="菜单">菜单</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">层级</label>
            <input
              type="number"
              min={0}
              className={systemFieldClass}
              value={mfLevel}
              onChange={(e) => setMfLevel(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">图标（Lucide 组件名，可自定义）</label>
          <input
            className={systemFieldClass}
            list="system-menu-icon-options"
            value={mfIcon}
            onChange={(e) => setMfIcon(e.target.value)}
          />
          <datalist id="system-menu-icon-options">
            {SYSTEM_MENU_ICON_OPTIONS.map((ic) => (
              <option key={ic} value={ic} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">路由路径</label>
          <input className={systemFieldClass} value={mfPath} onChange={(e) => setMfPath(e.target.value)} />
        </div>
      </SystemCrudModal>
    </div>
  );
}
