import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  status: string
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
        { id: 'resume-screening', title: '简历筛查 (AI)', roles: ['admin', 'recruiter'] },
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
      case 'project-list': return <ProjectManagementView role={currentRole} />;
      case 'job-query': return <JobQueryView onNavigate={setActiveMenu} currentRole={currentRole} authProfile={authProfile} />;
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

function ProjectManagementView({ role }: { role: Role }) {
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

  const openCreateModal = () => {
    const code = defaultNewProjectCode();
    setFormId(code);
    setFormName('');
    setFormDept('');
    setFormStart('');
    setFormEnd('');
    setFormDesc('');
    setCreateError('');
    setCreateOpen(true);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    const id = formId.trim();
    const name = formName.trim();
    if (!id || !name) {
      setCreateError('请填写项目编号与项目名称');
      return;
    }
    setCreateSubmitting(true);
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          projectCode: id,
          dept: formDept.trim() || undefined,
          startDate: formStart || undefined,
          endDate: formEnd || undefined,
          description: formDesc.trim() || undefined,
          memberCount: 0
        })
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) throw new Error(j.message || `创建失败 ${r.status}`);
      setCreateOpen(false);
      loadProjects();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败');
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
          <p className="text-slate-500 mt-1">管理所有招聘项目</p>
          {role === 'delivery_manager' ? (
            <p className="text-sm text-slate-400 mt-2">您只能看到本部门（华北交付中心）的项目信息。</p>
          ) : null}
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4" /> 创建项目
          </button>
        ) : null}
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
                    <h2 className="text-lg font-bold text-slate-900 leading-snug pr-2">{project.name}</h2>
                    <span className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-900 text-white">
                      {project.status || '进行中'}
                    </span>
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
                                    需求 <strong className="text-slate-700">{job.demand} 人</strong>
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
                        {canManage ? (
                          <p className="text-xs text-slate-400 px-2 pt-1">岗位请在业务库或同步流程中维护</p>
                        ) : null}
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
                  onClick={() => !createSubmitting && setCreateOpen(false)}
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
                <h3 className="text-lg font-bold text-slate-900">创建新招聘项目</h3>
                <button
                  type="button"
                  disabled={createSubmitting}
                  onClick={() => setCreateOpen(false)}
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
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 outline-none"
                      placeholder="PRJ-2024-001"
                      required
                    />
                    <p className="text-[11px] text-slate-400 mt-1">作为主键写入数据库，需唯一</p>
                  </div>
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
                    onClick={() => setCreateOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={createSubmitting}
                    className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                  >
                    {createSubmitting ? '创建中…' : '创建项目'}
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

function normalizeApplicationRow(r: Record<string, unknown>): Application {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    job: String(r.job ?? ''),
    resumeScore: Number(r.resumeScore ?? r.resumescore ?? 0) || 0,
    interviewScore: Number(r.interviewScore ?? r.interviewscore ?? 0) || 0,
    aiEval: String(r.aiEval ?? r.aieval ?? ''),
    status: String(r.status ?? '')
  };
}

type WorkbenchTodo = {
  key: string;
  title: string;
  tag: string;
  tagClass: string;
  borderClass: string;
  menuId: string;
};

function WorkbenchView({
  onNavigate,
  currentRole
}: {
  onNavigate: (id: string) => void;
  currentRole: Role;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [adminResumes, setAdminResumes] = useState<Resume[]>([]);
  const [screenRows, setScreenRows] = useState<
    Array<{
      id: number | string;
      status: string;
      report_summary: string | null;
      candidate_name?: string;
    }>
  >([]);
  const [screeningsOk, setScreeningsOk] = useState(false);
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
    void fetch('/api/applications')
      .then((res) => res.json())
      .then((rows: unknown[]) =>
        setApplications(
          Array.isArray(rows) ? rows.map((x) => normalizeApplicationRow(x as Record<string, unknown>)) : []
        )
      )
      .catch(() => setApplications([]));
  }, []);

  useEffect(() => {
    void fetch('/api/resumes')
      .then((res) => res.json())
      .then((rows: unknown[]) => {
        if (!Array.isArray(rows)) {
          setAdminResumes([]);
          return;
        }
        setAdminResumes(
          rows.map((raw) => {
            const r = raw as Record<string, unknown>;
            return {
              id: String(r.id ?? ''),
              name: String(r.name ?? ''),
              job: String(r.job ?? ''),
              matchScore: Number(r.matchScore ?? r.matchscore ?? 0) || 0,
              status: String(r.status ?? ''),
              uploadTime: String(r.uploadTime ?? r.uploadtime ?? '')
            };
          })
        );
      })
      .catch(() => setAdminResumes([]));
  }, []);

  useEffect(() => {
    if (!apiBase || !hasToken) {
      setScreenRows([]);
      setScreeningsOk(false);
      return;
    }
    void miniappApiFetch('/api/admin/resume-screenings')
      .then(async (r) => {
        const j = (await r.json()) as { data?: unknown[]; message?: string };
        if (!r.ok) throw new Error(j.message || 'fail');
        const data = j.data || [];
        setScreeningsOk(true);
        setScreenRows(
          data.map((x) => {
            const row = x as Record<string, unknown>;
            return {
              id: row.id as number | string,
              status: String(row.status ?? ''),
              report_summary: (row.report_summary as string | null) ?? null,
              candidate_name: String(row.candidate_name ?? '')
            };
          })
        );
      })
      .catch(() => {
        setScreenRows([]);
        setScreeningsOk(false);
      });
  }, [apiBase, hasToken, sessRev]);

  const activeProjectCount = projects.filter(
    (p) => !['EMPTY', 'UNASSIGNED'].includes(p.id) && !/待归档|已结束|已关闭/.test(p.status)
  ).length;

  const resumeReceivedCount = screeningsOk
    ? screenRows.length
    : adminResumes.length;

  const aiInterviewCount = applications.filter((a) => (a.interviewScore ?? 0) > 0).length;

  const hiredCount = applications.filter((a) => /录用|已入职|Offer|offer/i.test(a.status)).length;

  const pendingAiAnalysis = screeningsOk
    ? screenRows.filter(
        (s) =>
          !String(s.report_summary || '').trim() ||
          /待分析|分析中|排队|处理中/i.test(s.status)
      ).length
    : adminResumes.filter((r) => !/AI分析完成|不匹配|已拒绝/i.test(r.status)).length;

  const pendingScreenCount = applications.filter(
    (a) => a.status === '待初试' || a.status === '新建' || a.status === '待筛选'
  ).length;

  const hireApprovalCount = applications.filter((a) =>
    /待审批|录用审批|待录用|待 offer/i.test(a.status)
  ).length;

  const todos: WorkbenchTodo[] = [];
  if (pendingAiAnalysis > 0 && (currentRole === 'admin' || currentRole === 'recruiter')) {
    todos.push({
      key: 'ai',
      title: `${pendingAiAnalysis} 份简历待 AI 分析`,
      tag: '紧急',
      tagClass: 'bg-red-500 text-white',
      borderClass: 'border-red-200 bg-red-50/40',
      menuId: 'resume-screening'
    });
  }
  if (pendingScreenCount > 0 && (currentRole === 'admin' || currentRole === 'recruiter')) {
    todos.push({
      key: 'screen',
      title: `${pendingScreenCount} 位候选人待筛选`,
      tag: '待处理',
      tagClass: 'bg-white text-slate-800 border border-slate-200',
      borderClass: 'border-amber-200 bg-amber-50/30',
      menuId: 'resume-screening'
    });
  }
  if (hireApprovalCount > 0) {
    todos.push({
      key: 'hire',
      title: `${hireApprovalCount} 个录用审批待处理`,
      tag: '待审批',
      tagClass: 'bg-slate-900 text-white',
      borderClass: 'border-emerald-200 bg-emerald-50/40',
      menuId: 'application-mgmt'
    });
  }

  const recentProjects = projects
    .filter((p) => !['EMPTY', 'UNASSIGNED'].includes(p.id))
    .slice(0, 5);

  const recentCandidates = applications.slice(0, 8);

  const statCards = [
    {
      key: 'proj',
      label: '在招项目',
      value: activeProjectCount,
      icon: FolderOpen,
      iconWrap: 'bg-sky-100 text-sky-600'
    },
    {
      key: 'resume',
      label: '收到简历',
      value: resumeReceivedCount,
      icon: Users,
      iconWrap: 'bg-emerald-100 text-emerald-600'
    },
    {
      key: 'ai',
      label: 'AI 面试',
      value: aiInterviewCount,
      icon: Bot,
      iconWrap: 'bg-violet-100 text-violet-600'
    },
    {
      key: 'hire',
      label: '已录用',
      value: hiredCount,
      icon: UserCheck,
      iconWrap: 'bg-orange-100 text-orange-600'
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">工作台</h1>
        <p className="text-slate-500 mt-1">欢迎使用智能招聘管理系统</p>
      </div>

      {hireApprovalCount > 0 ? (
        <button
          type="button"
          onClick={() => onNavigate('application-mgmt')}
          className="w-full flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50/90 px-5 py-3.5 text-left shadow-sm hover:bg-emerald-50 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Info className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-sm font-medium text-emerald-900 truncate">
              {hireApprovalCount} 个录用审批待处理
            </span>
          </div>
          <span className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-900 text-white">
            待审批
          </span>
        </button>
      ) : null}

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
            <div>
              <p className="text-sm text-slate-500">{c.label}</p>
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{c.value}</p>
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
            todos.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onNavigate(t.menuId)}
                className={`w-full flex items-center justify-between gap-4 px-6 py-4 text-left border-l-4 border-l-transparent hover:bg-slate-50/80 transition-colors ${t.borderClass}`}
              >
                <span className="text-sm text-slate-800">
                  <span className="text-slate-400 mr-1">①</span>
                  {t.title}
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
            <h2 className="font-bold text-slate-900">最近候选人</h2>
            {(currentRole === 'admin' || currentRole === 'recruiter') && (
              <button
                type="button"
                onClick={() => onNavigate('application-mgmt')}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                初面管理
              </button>
            )}
          </div>
          <div className="p-4 space-y-3">
            {recentCandidates.length === 0 ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">暂无候选人记录</p>
            ) : (
              recentCandidates.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onNavigate('application-mgmt')}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">
                      {(a.name || '?')[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{a.name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {a.job} · 简历匹配 {a.resumeScore}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-slate-900 text-white">
                    {a.status || '—'}
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
};

function parseRecruitersInput(s: string): string[] {
  return s
    .split(/[,，、\n\r]+/)
    .map((x) => x.trim())
    .filter(Boolean);
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
        const meUsername = (authProfile?.username || '').trim().toLowerCase();
        const meName = (authProfile?.name || '').trim().toLowerCase();
        const meKeys = [meUsername, meName].filter(Boolean);
        for (const p of data) {
          if (p.id === 'EMPTY') continue;
          const pname = p.id === 'UNASSIGNED' ? '未分配项目岗位' : p.name;
          const pm = p.manager || '—';
          for (const job of p.jobs || []) {
            if (currentRole === 'recruiter') {
              const jr = (job.recruiters || []).map((x) => String(x).trim().toLowerCase());
              if (!jr.length) continue;
              const matched = jr.some((r) => meKeys.includes(r));
              if (!matched) continue;
            }
            out.push({ job, projectName: pname, projectManager: pm });
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
                <th className="px-5 py-3 font-medium whitespace-nowrap">HC</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">薪资范围</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">地点</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">列表时间</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">状态</th>
                <th className="px-5 py-3 font-medium text-right whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-slate-500">
                    暂无岗位数据，请点击右上角「+」添加
                  </td>
                </tr>
              ) : (
                rows.map(({ job, projectName, projectManager }) => {
                  const dept = job.department && job.department !== '-' ? job.department : '—';
                  const hc = `0/${job.demand}`;
                  const owner = jobAssignmentOwner(job, projectManager);
                  const when = (job.updatedAt || '').trim() || '—';
                  return (
                    <tr key={`${job.project_id}-${job.id}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-4 align-top">
                        <p className="font-semibold text-slate-900">{job.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{projectName}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-700 align-top">{dept}</td>
                      <td className="px-5 py-4 text-slate-700 align-top max-w-[140px]">
                        <span className="line-clamp-2" title={owner}>
                          {owner}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-800 font-medium tabular-nums align-top">{hc}</td>
                      <td className="px-5 py-4 text-slate-800 align-top whitespace-nowrap">{job.salary}</td>
                      <td className="px-5 py-4 text-slate-700 align-top">{job.location}</td>
                      <td className="px-5 py-4 text-slate-600 tabular-nums align-top whitespace-nowrap text-xs">
                        {when}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-100">
                          招聘中
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
    status: String(r.status || ''),
    uploadTime,
    reportSummary: String(r.report_summary || '')
  }
}

function ResumeScreeningView() {
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
          report_summary: string | null
          created_at: string | Date
        }>
        setResumes(rows.map((row) => mapScreeningRow(row)));
      })
      .catch(() => {
        setResumes([]);
        setScreenListError('筛查记录暂时无法加载，请稍后重试或联系管理员检查系统是否已升级、网络是否正常。');
      });
  }, [apiBase, hasToken, sessRev]);

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
        setInviteJobs(j.data || []);
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
  }, [apiBase, hasToken, sessRev]);

  useEffect(() => {
    if (inviteJobs.length === 0) return;
    setSelectedJobCode((prev) => {
      if (prev && inviteJobs.some((j) => j.job_code === prev)) return prev;
      return inviteJobs[0].job_code;
    });
  }, [inviteJobs]);

  const handleMiniappInvite = async (jobCode: string) => {
    setLastInvite(null);
    setCreatingInvite(jobCode);
    try {
      const recruiterCode = getAdminLoginProfile()?.username || '';
      const r = await miniappApiFetch('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify({ jobCode, expiresInDays: 7, recruiterCode })
      });
      const j = (await r.json()) as { data?: { inviteCode: string; jobCode: string }; message?: string };
      if (!r.ok) throw new Error(j.message || `发起失败 HTTP ${r.status}`);
      if (j.data?.inviteCode) {
        setLastInvite({ inviteCode: j.data.inviteCode, jobCode: j.data.jobCode });
        setInviteBanner('');
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
        void handleMiniappInvite(byCode.job_code);
        return;
      }
    }
    const name = (resume.job || '').trim();
    if (!name) {
      setInviteBanner('该简历未标注匹配岗位，请在上方岗位列表中手动发起面试。');
      return;
    }
    const matched =
      inviteJobs.find((j) => j.job_code === name) ||
      inviteJobs.find((j) => j.title === name) ||
      inviteJobs.find((j) => name.includes(j.title) || j.title.includes(name));
    if (!matched) {
      setInviteBanner(`未在岗位列表中找到与「${name}」对应的岗位，请在上方列表中选择正确岗位发起面试。`);
      return;
    }
    void handleMiniappInvite(matched.job_code);
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
          <h4 className="font-bold text-emerald-900">按简历结果发起面试</h4>
          <p className="text-sm text-emerald-800 mt-1 leading-relaxed">
            <strong className="font-semibold text-emerald-950">候选人无需事先在小程序里注册或登录。</strong>
            您先完成简历分析，再在候选人卡片点击「发起面试」生成邀请码，并将码通过微信/短信等发给对方；对方
            <strong className="font-semibold text-emerald-950">首次打开小程序</strong>，在
            <strong className="font-semibold text-emerald-950">「欢迎参加面试」登录页</strong>
            填写真实姓名与邀请码（即下方生成的 INV 开头一串字符），点下一步即可完成登记并进入面试准备页。
          </p>
        </div>
      </div>
      {inviteBanner ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">{inviteBanner}</div>
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
                disabled={!inviteJobs.length || inviteJobsLoading}
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
                <p className="text-xs font-medium text-slate-500 mb-1">匹配度 {reportResume.matchScore} 分 · {reportResume.status}</p>
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

function ApplicationManagementView() {
  const [rows, setRows] = useState<Array<{
    id: string
    candidateName: string
    jobCode: string
    jobTitle: string
    score: number
    skill: number
    experience: number
    education: number
    stability: number
    status: string
    summary: string
  }>>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [reportLoadingId, setReportLoadingId] = useState<string | null>(null)
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

  const loadRows = useCallback(() => {
    setLoading(true)
    setErr('')
    void miniappApiFetch('/api/admin/resume-screenings')
      .then(async (r) => {
        const j = (await r.json()) as { data?: unknown[]; message?: string }
        if (!r.ok) throw new Error(j.message || `加载失败 ${r.status}`)
        const data = Array.isArray(j.data) ? j.data : []
        setRows(
          data.map((x) => {
            const row = x as Record<string, unknown>
            const overall = Math.max(0, Math.min(100, Number(row.match_score) || 0))
            const d = dimsFromScreeningDbRow(
              {
                skill_score: row.skill_score as number | null | undefined,
                experience_score: row.experience_score as number | null | undefined,
                education_score: row.education_score as number | null | undefined,
                stability_score: row.stability_score as number | null | undefined
              },
              overall
            )
            return {
              id: String(row.id ?? ''),
              candidateName: String(row.candidate_name ?? '候选人'),
              jobCode: String(row.job_code ?? ''),
              jobTitle: String(row.matched_job_title ?? row.job_code ?? ''),
              score: overall,
              skill: d.skill,
              experience: d.experience,
              education: d.education,
              stability: d.stability,
              status: String(row.status ?? '待初面'),
              summary: String(row.report_summary ?? '')
            }
          })
        )
      })
      .catch((e: unknown) => {
        setRows([])
        setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadRows()
  }, [loadRows])

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
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-900">初面管理（AI 简历评估）</h3>
          <button
            type="button"
            onClick={loadRows}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            刷新
          </button>
        </div>
        {err ? <div className="px-6 py-3 text-sm text-red-600 border-b border-slate-100">{err}</div> : null}
        <table className="w-full text-left text-sm">
          <thead className="bg-white border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-6 py-4 font-medium">候选人</th>
              <th className="px-6 py-4 font-medium">岗位</th>
              <th className="px-6 py-4 font-medium">综合分</th>
              <th className="px-6 py-4 font-medium">维度评分</th>
              <th className="px-6 py-4 font-medium w-1/3">AI 结论</th>
              <th className="px-6 py-4 font-medium">状态</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td className="px-6 py-8 text-slate-500" colSpan={7}>加载中...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-6 py-8 text-slate-500" colSpan={7}>暂无数据，请先在简历筛查上传简历</td></tr>
            ) : (
              rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900">{row.candidateName}</td>
                    <td className="px-6 py-4 text-slate-600">{row.jobTitle}（{row.jobCode}）</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">
                        <BrainCircuit className="w-3.5 h-3.5" /> {row.score}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600 leading-relaxed">
                      技能 {row.skill} / 经验 {row.experience} / 学历 {row.education} / 稳定 {row.stability}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs leading-relaxed">{row.summary || '—'}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">{row.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        disabled={Boolean(reportLoadingId)}
                        onClick={() => void handleOpenInterviewReport(row)}
                        className="text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
                      >
                        {reportLoadingId === row.id ? '加载中…' : '面试报告'}
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

function SystemCrudHint() {
  return (
    <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2">
      增删改将直接写入管理库{' '}
      <code className="text-xs bg-white px-1 rounded border border-slate-200">ai_recruit_admin</code>
      。新建用户密码与服务端库表登录使用相同的 scrypt 存储格式。
    </p>
  );
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
      <SystemCrudHint />
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
      <SystemCrudHint />
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
      <SystemCrudHint />
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
      <SystemCrudHint />
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
