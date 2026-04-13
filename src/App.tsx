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
  LogOut, Bell, LayoutDashboard, FolderOpen, Bot,
  Clock, Info, Calendar, Pencil, Trash2, Loader2, KeyRound
} from 'lucide-react';

/**
 * 小程序 / 管理端会话 API 根地址（/api/admin/* 等）。
 * 1) 生产：server.ts 可注入 window.__ADMIN_MINIAPP_API_BASE__（MINIAPP_API_PUBLIC_URL）。
 * 2) 构建期 VITE_API_BASE。
 * 3) 本地开发：与当前页面同源（如 http://localhost:3010），由 server.ts 将 /api/admin 代理到 server/index.ts（默认 :3001），避免只开 npm run dev 时误连 3001 导致 ERR_CONNECTION_REFUSED。
 */
function resolveMiniappApiBase(): string {
  if (typeof window !== 'undefined') {
    const injected = String((window as unknown as { __ADMIN_MINIAPP_API_BASE__?: string }).__ADMIN_MINIAPP_API_BASE__ || '').trim()
    if (injected) return injected.replace(/\/$/, '')
  }
  const v = (import.meta.env.VITE_API_BASE || '').trim()
  if (v) return v
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location
    const local =
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
    if (local && (import.meta.env.DEV || import.meta.env.MODE === 'development')) {
      const p = port ? `:${port}` : ''
      return `${protocol}//${hostname}${p}`.replace(/\/$/, '')
    }
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
type Role = 'admin' | 'delivery_manager' | 'recruiter' | 'recruiting_manager';

function roleFallbackLabel(r: Role): string {
  if (r === 'admin') return '管理员'
  if (r === 'delivery_manager') return '交付经理'
  if (r === 'recruiting_manager') return '招聘经理'
  return '招聘人员'
}

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

/** 与侧边栏菜单 id 一致；写入管理库 roles.menu_keys（JSON 数组） */
const ADMIN_ROLE_MENU_OPTIONS: { group: string; items: { id: string; label: string }[] }[] = [
  /** 二期：可恢复「工作台」workbench 菜单项 */
  {
    group: '岗位管理',
    items: [
      { id: 'project-list', label: '项目管理' },
      { id: 'job-query', label: '岗位分配' }
    ]
  },
  {
    group: '招聘管理',
    items: [
      { id: 'resume-screening', label: '简历筛查' },
      { id: 'application-mgmt', label: '初面管理' }
    ]
  },
  {
    group: '系统管理',
    items: [
      { id: 'sys-dept', label: '部门管理' },
      { id: 'sys-user', label: '用户管理' },
      { id: 'sys-role', label: '角色管理' },
      { id: 'sys-menu', label: '菜单管理' }
    ]
  }
];

function filterNavByAcl(nav: NavItem[], uiRole: Role, allowedMenuKeys?: string[] | null): NavItem[] {
  const useAcl = Array.isArray(allowedMenuKeys)
  const keySet = useAcl ? new Set(allowedMenuKeys) : null

  return nav
    .map((item) => {
      if (item.children?.length) {
        let children: NavChild[]
        if (useAcl && keySet) {
          // 管理库 roles.menu_keys 白名单：显式授权的 id 可突破子项/父级在模板里的默认 roles（如系统管理仅 admin）
          children = item.children.filter((c) => keySet.has(c.id))
        } else {
          if (!item.roles.includes(uiRole)) return null
          children = item.children.filter((c) => !c.roles || c.roles.includes(uiRole))
        }
        if (children.length === 0) return null
        return { ...item, children }
      }
      if (useAcl && keySet) {
        if (!keySet.has(item.id)) return null
        return item
      }
      if (!item.roles.includes(uiRole)) return null
      return item
    })
    .filter(Boolean) as NavItem[]
}

function collectNavIds(nav: NavItem[]): string[] {
  const out: string[] = []
  for (const n of nav) {
    if (n.children?.length) {
      for (const c of n.children) out.push(c.id)
    } else {
      out.push(n.id)
    }
  }
  return out
}

const NAV_TEMPLATE: NavItem[] = [
  /** 二期：可恢复顶层「工作台」菜单（id: workbench → WorkbenchView） */
  {
    id: 'projects',
    title: '岗位管理',
    icon: <Briefcase className="w-5 h-5" />,
    roles: ['admin', 'delivery_manager', 'recruiter', 'recruiting_manager'],
    children: [
      {
        id: 'project-list',
        title: '项目管理',
        roles: ['admin', 'delivery_manager', 'recruiter', 'recruiting_manager'],
        icon: <Briefcase className="w-4 h-4" />
      },
      {
        id: 'job-query',
        title: '岗位分配',
        roles: ['admin', 'recruiter', 'delivery_manager', 'recruiting_manager'],
        icon: <UserCog className="w-4 h-4" />
      }
    ]
  },
  {
    id: 'recruitment',
    title: '招聘管理',
    icon: <Users className="w-5 h-5" />,
    roles: ['admin', 'recruiter', 'recruiting_manager', 'delivery_manager'],
    children: [
      {
        id: 'resume-screening',
        title: '简历筛查',
        roles: ['admin', 'recruiter', 'recruiting_manager', 'delivery_manager']
      },
      { id: 'application-mgmt', title: '初面管理', roles: ['admin', 'recruiter', 'recruiting_manager'] }
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
]

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
  /** 历史字段 jobs.claimed_by，界面已不再使用认领流程 */
  claimedBy?: string;
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
  /** 项目侧招聘经理名单，由交付经理/管理员维护；招聘经理凭此获得下属岗位「招聘人员」配置权限 */
  recruitmentLeads?: string[];
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
  /** 上传时填写的手机号，存于 resume_screenings.candidate_phone */
  phone?: string
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
export interface Dept {
  id: string;
  name: string;
  level: number;
  manager: string;
  count: number;
  /** 上级部门 id，空为顶级 */
  parentId?: string | null;
}
export interface User { id: string; name: string; username: string; dept: string; role: string; status: string; }

/** 部门名比对：去空白、全角空格、Unicode 兼容规范化，避免「交付八部」与库内不可见字符不一致 */
function normalizeDeptForMatch(s: string): string {
  try {
    return String(s || '')
      .normalize('NFKC')
      .replace(/[\s\u3000]+/g, ' ')
      .trim()
      .toLowerCase();
  } catch {
    return String(s || '')
      .replace(/[\s\u3000]+/g, ' ')
      .trim()
      .toLowerCase();
  }
}

function deptNamesMatch(userDept: string, deptName: string): boolean {
  const a = normalizeDeptForMatch(userDept);
  const b = normalizeDeptForMatch(deptName);
  if (!a || !b || a === '-' || b === '-') return false;
  return a === b;
}

/** 自定义菜单白名单下是否包含「岗位分配」；无白名单时视为拥有默认菜单（含岗位分配） */
function deliveryManagerHasJobQueryMenu(auth: AdminLoginProfile | null): boolean {
  const keys = auth?.allowedMenuKeys;
  if (!Array.isArray(keys)) return true;
  return keys.includes('job-query');
}

/** 交付经理：仅保留与本人 users.dept 一致的真实项目；不含未分配/占位项目桶 */
function filterProjectsForDeliveryManagerScope(projects: Project[], userDept: string | null | undefined): Project[] {
  const ud = String(userDept || '').trim();
  if (!ud || ud === '-') return [];
  return projects.filter(
    (p) => p.id !== 'EMPTY' && p.id !== 'UNASSIGNED' && deptNamesMatch(ud, String(p.dept || ''))
  );
}

/** 将 /api/users 响应规范为 User[] */
function usersFromApiPayload(data: unknown): User[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id ?? ''),
        name: String(r.name ?? '').trim(),
        username: String(r.username ?? '').trim(),
        dept: String(r.dept ?? '').trim(),
        role: String(r.role ?? '').trim(),
        status: String(r.status ?? '正常').trim() || '正常'
      };
    })
    .filter((u) => u.username);
}

function activeUsersInDept(users: User[], deptName: string): User[] {
  const d = deptName.trim();
  if (!d) return [];
  return users.filter(
    (u) => u.status === '正常' && u.dept && u.dept !== '-' && deptNamesMatch(u.dept, d)
  );
}

const CN_MOBILE_LOGIN_USERNAME_RE = /^1[3-9]\d{9}$/;

/** 平台管理员等可使用非手机号登录名；其余角色须为大陆手机号 */
function roleAllowsNonMobileLoginUsername(role: string): boolean {
  const r = String(role || '').trim();
  return /平台管理员|系统管理|超级管理/i.test(r) || r === '管理员';
}

function loginUsernameErrorForRole(username: string, role: string): string | null {
  if (roleAllowsNonMobileLoginUsername(role)) return null;
  const u = username.trim();
  if (!CN_MOBILE_LOGIN_USERNAME_RE.test(u)) {
    return '非管理员角色的登录账号须为 11 位中国大陆手机号（1 开头，第二位 3–9）';
  }
  return null;
}

export interface SysRole {
  id: string;
  name: string;
  desc: string;
  users: number;
  /** null/undefined：不单独限制，侧边栏按职级默认；[] 或非空数组：与职级求交 */
  menuKeys?: string[] | null;
}
export interface Menu {
  id: string;
  name: string;
  type: string;
  icon: string;
  path: string;
  level: number;
  /** 上级菜单 id；需管理库 menus.parent_id 列（见 server/migration_menus_parent_id.sql） */
  parentId?: string | null;
}

function mapMenuRow(m: Record<string, unknown>): Menu {
  const pid = m.parent_id ?? m.parentId;
  return {
    id: String(m.id ?? ''),
    name: String(m.name ?? ''),
    type: String(m.type ?? ''),
    icon: String(m.icon ?? ''),
    path: String(m.path ?? ''),
    level: Number(m.level) || 0,
    parentId: pid != null && String(pid).trim() ? String(pid).trim() : null
  };
}

function flattenMenuTreeForDisplay(menus: Menu[]): { menu: Menu; depth: number }[] {
  const idSet = new Set(menus.map((x) => x.id));
  const byParent = new Map<string | null, Menu[]>();
  for (const m of menus) {
    const raw = (m.parentId || '').trim();
    const p = raw && idSet.has(raw) ? raw : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(m);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-CN'));
  }
  const out: { menu: Menu; depth: number }[] = [];
  const walk = (parentKey: string | null, depth: number) => {
    for (const menu of byParent.get(parentKey) || []) {
      out.push({ menu, depth });
      walk(menu.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function filterMenusForSearchTree(menus: Menu[], q: string): Menu[] {
  const qq = q.trim().toLowerCase();
  if (!qq) return menus;
  const byId = new Map(menus.map((m) => [m.id, m]));
  const keep = new Set<string>();
  for (const m of menus) {
    const hit =
      String(m.name || '')
        .toLowerCase()
        .includes(qq) ||
      String(m.path || '')
        .toLowerCase()
        .includes(qq) ||
      String(m.type || '')
        .toLowerCase()
        .includes(qq);
    if (hit) {
      let cur: Menu | undefined = m;
      while (cur) {
        keep.add(cur.id);
        const p = (cur.parentId || '').trim();
        cur = p ? byId.get(p) : undefined;
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of menus) {
      const p = (m.parentId || '').trim();
      if (p && keep.has(p) && !keep.has(m.id)) {
        keep.add(m.id);
        changed = true;
      }
    }
  }
  return menus.filter((m) => keep.has(m.id));
}

function suggestedChildMenuPath(parent: Menu): string {
  const base = (parent.path || '').trim().replace(/\/$/, '');
  if (!base || base === '/') return '/module-path';
  return `${base}/module-path`;
}

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

  /** 交付经理会话缺少「所属部门」时，从用户管理同源接口回填（兼容旧 session、或曾未下发 dept） */
  useEffect(() => {
    const p = authProfile;
    if (!p || p.uiRole !== 'delivery_manager') return;
    const d = String(p.dept || '').trim();
    if (d && d !== '-') return;
    let cancelled = false;
    void fetch('/api/users')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled) return;
        const users = usersFromApiPayload(data);
        const un = String(p.username || '').trim();
        const me = users.find((u) => String(u.username || '').trim() === un);
        const fetched = String(me?.dept || '').trim();
        if (!fetched || fetched === '-') return;
        setAdminLoginProfile({ ...p, dept: fetched });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authProfile?.username, authProfile?.uiRole, authProfile?.dept]);

  /** 与登录账号职级一致，不再提供视角切换 */
  const currentRole: Role = authProfile?.uiRole ?? 'delivery_manager';
  const [activeMenu, setActiveMenu] = useState('project-list');
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
      const u = j.data?.user as AdminLoginProfile & { allowedMenuKeys?: string[] };
      if (u?.uiRole && u.username) {
        const profile: AdminLoginProfile = {
          name: String(u.name || u.username),
          username: String(u.username),
          uiRole: u.uiRole
        };
        if (u != null && typeof u === 'object' && 'dept' in u) {
          profile.dept = String((u as { dept?: unknown }).dept ?? '').trim();
        }
        if (Array.isArray(u.allowedMenuKeys)) {
          profile.allowedMenuKeys = u.allowedMenuKeys.map((x) => String(x || '').trim()).filter(Boolean);
        }
        setAdminLoginProfile(profile);
        const firstMenu = collectNavIds(
          filterNavByAcl(NAV_TEMPLATE, profile.uiRole, profile.allowedMenuKeys)
        )[0];
        if (firstMenu) setActiveMenu(firstMenu);
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

  const navConfig = useMemo(
    () => filterNavByAcl(NAV_TEMPLATE, currentRole, authProfile?.allowedMenuKeys),
    [currentRole, authProfile?.allowedMenuKeys]
  );

  useEffect(() => {
    const ids = collectNavIds(navConfig)
    if (ids.length === 0) return
    if (!ids.includes(activeMenu)) {
      setActiveMenu(ids[0])
    }
  }, [navConfig, activeMenu])

  const renderContent = () => {
    if (collectNavIds(navConfig).length === 0) {
      return (
        <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-6 py-10 text-center text-sm text-amber-950 leading-relaxed max-w-xl mx-auto">
          当前账号在侧边栏<strong>没有可用的菜单项</strong>（可能与职级或角色菜单配置有关）。请联系管理员在「角色管理」中为您的角色勾选可见菜单，并确认用户管理中的「角色」与角色名称一致。
        </div>
      );
    }
    switch (activeMenu) {
      case 'clients': return <ClientManagementView />;
      case 'project-list': return <ProjectManagementView role={currentRole} onNavigate={setActiveMenu} authProfile={authProfile} />;
      case 'job-query': return <JobQueryView onNavigate={setActiveMenu} currentRole={currentRole} authProfile={authProfile} />;
      case 'resume-screening': return <ResumeScreeningView currentRole={currentRole} authProfile={authProfile} />;
      case 'application-mgmt': return <ApplicationManagementView currentRole={currentRole} authProfile={authProfile} />;
      case 'sys-dept': return <SystemDeptView />;
      case 'sys-user': return <SystemUserView currentRole={currentRole} authProfile={authProfile} />;
      case 'sys-role': return <SystemRoleView />;
      case 'sys-menu': return <SystemMenuView />;
      default: return <div className="p-8 text-slate-500">模块开发中...</div>;
    }
  };

  return (
    <>
      {changePwdOpen && !showHrApiLogin
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
      {showHrApiLogin ? (
        <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-100 via-white to-slate-50">
          <header className="shrink-0 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm">
            <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
              <BrainCircuit className="w-9 h-9 text-indigo-600 shrink-0" aria-hidden />
              <div>
                <p className="text-lg font-bold text-slate-900 tracking-tight">智能招聘系统</p>
                <p className="text-xs text-slate-500">管理端登录</p>
              </div>
            </div>
          </header>
          <main className="flex-1 flex flex-col items-center justify-center px-4 py-10 sm:py-14">
            <div className="w-full max-w-md">
              <form
                onSubmit={submitHrLogin}
                className="bg-white rounded-2xl border border-slate-200 shadow-lg shadow-slate-200/60 p-8 sm:p-10 space-y-5"
              >
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 tracking-tight">登录</h1>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    登录后即可使用简历筛查、面试邀请等与候选人端联动的功能。
                  </p>
                </div>

                <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-violet-50/80 px-4 py-3">
                  <div className="flex gap-2.5">
                    <div className="shrink-0 mt-0.5 text-indigo-600">
                      <Info className="w-4 h-4" aria-hidden />
                    </div>
                    <div className="text-sm text-indigo-950/90 leading-relaxed space-y-2">
                      <p className="font-medium text-indigo-950">请使用后台已开通的账号</p>
                      <p className="text-indigo-950/85">
                        账号与密码由管理员在<strong className="font-semibold text-indigo-950">用户管理</strong>
                        中维护；除平台管理员外，账号一般为<strong className="font-semibold">手机号</strong>
                        。若部署时已配置访问令牌，可能无需在此登录。
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">登录账号</label>
                  <input
                    value={loginUser}
                    onChange={(e) => setLoginUser(e.target.value)}
                    autoComplete="username"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none transition-shadow"
                    placeholder="手机号，或管理员账号如 admin"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">密码</label>
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
                  className="w-full bg-indigo-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {loginLoading ? '登录中…' : '进入系统'}
                </button>
              </form>
              <p className="text-center text-xs text-slate-400 mt-8">登录成功后将进入您有权限的首个功能页</p>
            </div>
          </main>
        </div>
      ) : (
      <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-20">
        <div className="h-16 flex items-center px-6 border-b border-slate-800 bg-slate-950">
          <BrainCircuit className="w-6 h-6 text-indigo-400 mr-3" />
          <span className="text-lg font-bold text-white tracking-wide">智能招聘系统</span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          {navConfig.map((nav) => (
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
                        {nav.children.map((child) => (
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
              {navConfig.flatMap(n => n.children ? [n, ...n.children] : [n]).find(n => n.id === activeMenu)?.title || '招聘管理'}
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
                {currentRole === 'admin'
                  ? 'A'
                  : currentRole === 'delivery_manager'
                    ? 'D'
                    : currentRole === 'recruiting_manager'
                      ? 'M'
                      : 'R'}
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
      )}
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

/** 列表与卡片：优先项目招聘负责人名单，兼容仅填过 manager 的旧数据 */
function projectRecruitingLeadDisplay(p: { recruitmentLeads?: string[]; manager?: string }): string {
  const leads = (p.recruitmentLeads ?? []).map((x) => String(x || '').trim()).filter(Boolean);
  if (leads.length) return leads.join('、');
  const m = String(p.manager || '').trim();
  if (m && m !== '-') return m;
  return '—';
}

function ProjectManagementView({
  role,
  onNavigate,
  authProfile
}: {
  role: Role;
  onNavigate?: (id: string) => void;
  authProfile: AdminLoginProfile | null;
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
  const [formStatus, setFormStatus] = useState('进行中');
  const [formMemberCount, setFormMemberCount] = useState('0');
  const [formProjectCode, setFormProjectCode] = useState('');
  const [hrUsers, setHrUsers] = useState<User[]>([]);
  const [formProjectRecruitmentLeads, setFormProjectRecruitmentLeads] = useState('');
  const [projectLeadPickDept, setProjectLeadPickDept] = useState('');
  const [projectLeadPickUsername, setProjectLeadPickUsername] = useState('');
  const [projectJobForm, setProjectJobForm] = useState<JobFormState | null>(null);
  const [pjRecruiterPickDept, setPjRecruiterPickDept] = useState('');
  const [pjRecruiterPickUsername, setPjRecruiterPickUsername] = useState('');
  const [projectJobLockId, setProjectJobLockId] = useState<string | null>(null);

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

  useEffect(() => {
    void fetch('/api/users')
      .then((res) => res.json())
      .then((data: unknown) => setHrUsers(usersFromApiPayload(data)))
      .catch(() => setHrUsers([]));
  }, []);

  const closeProjectModal = () => {
    if (createSubmitting) return;
    setCreateOpen(false);
    setEditingProjectId(null);
    setFormProjectRecruitmentLeads('');
    setProjectLeadPickDept('');
    setProjectLeadPickUsername('');
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
    setFormStatus('进行中');
    setFormMemberCount('0');
    setFormProjectCode('');
    setFormProjectRecruitmentLeads('');
    setProjectLeadPickDept('');
    setProjectLeadPickUsername('');
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
    setFormStatus((p.status || '进行中').trim() || '进行中');
    setFormMemberCount(String(p.memberCount ?? 0));
    setFormProjectCode((p.projectCode || p.id || '').trim());
    setFormProjectRecruitmentLeads((p.recruitmentLeads && p.recruitmentLeads.length ? p.recruitmentLeads : []).join('、'));
    setProjectLeadPickDept('');
    setProjectLeadPickUsername('');
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
        const patchBody: Record<string, unknown> = {
          name,
          dept: formDept.trim() || null,
          status: formStatus.trim() || '进行中',
          startDate: formStart || null,
          endDate: formEnd || null,
          description: formDesc.trim() || null,
          memberCount,
          projectCode: formProjectCode.trim() || null
        };
        if (role === 'admin' || role === 'delivery_manager') {
          patchBody.recruitmentLeads = parseRecruitersInput(formProjectRecruitmentLeads);
        }
        const r = await fetch(`/api/projects/${encodeURIComponent(editingProjectId!)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody)
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `保存失败 ${r.status}`);
      } else {
        const postBody: Record<string, unknown> = {
          id,
          name,
          projectCode: id,
          dept: formDept.trim() || undefined,
          status: formStatus.trim() || undefined,
          startDate: formStart || undefined,
          endDate: formEnd || undefined,
          description: formDesc.trim() || undefined,
          memberCount
        };
        if (role === 'admin' || role === 'delivery_manager') {
          postBody.recruitmentLeads = parseRecruitersInput(formProjectRecruitmentLeads);
        }
        const r = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody)
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

  const dmUserDept = String(authProfile?.dept || '').trim();
  const dmDeptReady =
    role !== 'delivery_manager' || (dmUserDept.length > 0 && dmUserDept !== '-');

  const listProjects = useMemo(() => {
    const base = projects.filter((p) => p.id !== 'EMPTY' && p.id !== 'UNASSIGNED');
    if (role === 'recruiting_manager') return filterProjectsForRecruitingManagerScope(base, authProfile);
    if (role !== 'delivery_manager') return base;
    if (!dmDeptReady) return [];
    return filterProjectsForDeliveryManagerScope(projects, dmUserDept);
  }, [projects, role, dmDeptReady, dmUserDept, authProfile]);

  const totalRealProjects = useMemo(
    () => projects.filter((p) => p.id !== 'EMPTY' && p.id !== 'UNASSIGNED').length,
    [projects]
  );
  const recruitingManagerNoLeadProjects =
    role === 'recruiting_manager' && listProjects.length === 0 && totalRealProjects > 0;

  const dmJobQueryMenu = role === 'delivery_manager' ? deliveryManagerHasJobQueryMenu(authProfile) : true;
  const selectableProjectsForJob = listProjects;

  const openProjectJobCreate = (projectId: string) => {
    setPjRecruiterPickDept('');
    setPjRecruiterPickUsername('');
    setProjectJobLockId(projectId);
    setProjectJobForm({
      mode: 'create',
      submitting: false,
      error: '',
      jobCode: '',
      title: '',
      projectId,
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

  const openProjectJobEdit = (project: Project, job: Job) => {
    setPjRecruiterPickDept('');
    setPjRecruiterPickUsername('');
    setProjectJobLockId(project.id);
    const pid = job.project_id === 'UNASSIGNED' ? project.id : job.project_id || project.id;
    setProjectJobForm({
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

  const submitProjectJobForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectJobForm) return;
    const title = projectJobForm.title.trim();
    if (!title) {
      setProjectJobForm((f) => (f ? { ...f, error: '请填写岗位名称' } : f));
      return;
    }
    const rawPid = String(projectJobLockId || projectJobForm.projectId.trim() || '').trim();
    if (!rawPid) {
      setProjectJobForm((f) => (f ? { ...f, error: '请选择所属项目' } : f));
      return;
    }
    setProjectJobForm((f) => (f ? { ...f, submitting: true, error: '' } : f));
    const demand = Math.max(1, Math.min(99999, Number(projectJobForm.demand) || 1));
    const projectId = rawPid;
    /** 项目管理里维护岗位：交付经理/管理员不维护岗位「招聘人员」，由招聘经理在岗位分配中配置 */
    const payload: Record<string, unknown> = {
      title,
      projectId,
      department: projectJobForm.department.trim() || null,
      demand,
      location: projectJobForm.location.trim() || null,
      skills: projectJobForm.skills.trim() || null,
      level: projectJobForm.level.trim() || null,
      salary: projectJobForm.salary.trim() || null,
      jdText: projectJobForm.jdText.trim() || null
    };
    try {
      if (projectJobForm.mode === 'create') {
        const jc = projectJobForm.jobCode.trim();
        const body: Record<string, unknown> = { ...payload, recruiters: [] };
        if (jc) body.jobCode = jc.toUpperCase();
        const r = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `创建失败 ${r.status}`);
      } else {
        const r = await fetch(`/api/jobs/${encodeURIComponent(projectJobForm.jobCode)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `保存失败 ${r.status}`);
      }
      setProjectJobForm(null);
      setProjectJobLockId(null);
      loadProjects();
    } catch (err) {
      setProjectJobForm((f) =>
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

  const handleProjectPanelDeleteJob = async (job: Job) => {
    if (!window.confirm(`确定删除岗位「${job.title}」（${job.id}）？不可恢复。`)) return;
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) throw new Error(j.message || `删除失败 ${r.status}`);
      loadProjects();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '删除失败');
    }
  };

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
            管理员可查看全部项目。交付经理仅展示与本人「所属部门」一致的项目。招聘经理仅展示在「项目招聘负责人」中包含本人姓名或登录账号的项目。以上均不展示「未分配项目」占位数据；未归入项目的岗位请在「岗位分配」中查看。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManage && dmDeptReady ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> 创建项目
            </button>
          ) : null}
          {(role === 'admin' ||
            role === 'recruiter' ||
            role === 'recruiting_manager' ||
            (role === 'delivery_manager' && dmJobQueryMenu)) &&
          onNavigate ? (
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

      {role === 'delivery_manager' && !dmDeptReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 text-amber-950 px-5 py-4 text-sm leading-relaxed max-w-2xl">
          当前账号未设置「所属部门」，无法按部门筛选项目。请管理员在「用户管理」中为您填写部门（须与项目上的部门名称一致），保存后重新登录。
        </div>
      ) : null}
      {recruitingManagerNoLeadProjects ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 text-amber-950 px-5 py-4 text-sm leading-relaxed max-w-2xl">
          当前账号未被设为任何项目的「项目招聘负责人」，因此不展示项目列表。请交付经理或管理员在「项目管理」中编辑对应项目，将您的姓名或登录账号加入「项目招聘负责人」。
        </div>
      ) : null}

      {listProjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">
          <p className="text-sm">暂无招聘项目</p>
          {canManage && dmDeptReady ? (
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
                      <span className="text-slate-400">项目招聘负责人</span>{' '}
                      <span className="font-medium text-slate-800">
                        {projectRecruitingLeadDisplay(project)}
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
                        {canManage ? (
                          <div className="flex justify-end px-2">
                            <button
                              type="button"
                              onClick={() => openProjectJobCreate(project.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              添加岗位
                            </button>
                          </div>
                        ) : null}
                        {project.jobs.length === 0 ? (
                          <p className="text-sm text-slate-500 px-2">该项目下暂无岗位</p>
                        ) : (
                          project.jobs.map((job) => (
                            <div
                              key={job.id}
                              className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                            >
                              <div className="min-w-0 flex-1">
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
                              <div className="flex flex-col sm:flex-row sm:items-start gap-3 shrink-0">
                                {canManage ? (
                                  <div className="flex items-center gap-1 order-first sm:order-none">
                                    <button
                                      type="button"
                                      onClick={() => openProjectJobEdit(project, job)}
                                      className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                                      aria-label="编辑岗位"
                                    >
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleProjectPanelDeleteJob(job)}
                                      className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                      aria-label="删除岗位"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : null}
                                <div className="text-left sm:text-right">
                                  <div className="text-xs text-slate-500 mb-1">可见招聘人员</div>
                                  <div className="flex flex-wrap gap-1 sm:justify-end">
                                    {(job.recruiters || []).map((r) => (
                                      <span
                                        key={r}
                                        className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-md border border-indigo-100"
                                      >
                                        {r}
                                      </span>
                                    ))}
                                  </div>
                                  {!job.recruiters?.length ? (
                                    <p className="text-xs text-slate-400 mt-2">未设置招聘负责人</p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                        {(role === 'admin' ||
                          role === 'recruiter' ||
                          role === 'recruiting_manager' ||
                          (role === 'delivery_manager' && dmJobQueryMenu)) &&
                        onNavigate ? (
                          <button
                            type="button"
                            onClick={() => onNavigate('job-query')}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 pt-1 text-left w-full"
                          >
                            在「岗位分配」中查看或编辑全部岗位 →
                          </button>
                        ) : (
                          <p className="text-xs text-slate-400 px-2 pt-1">
                            岗位由管理员、交付经理、招聘经理或招聘人员在项目明细与「岗位分配」中维护。
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(role === 'admin' || role === 'delivery_manager') && (
                      <div className="sm:col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-3 space-y-2">
                        <label className="block text-xs font-medium text-slate-600">
                          项目招聘负责人（招聘经理）
                        </label>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          由交付经理或管理员维护；可跨部门添加多名招聘经理。配置完成后，对应招聘经理可在「岗位分配」中为该项目下的每个岗位指定一名招聘人员。
                        </p>
                        <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                          {parseRecruitersInput(formProjectRecruitmentLeads).map((name, i) => (
                            <span
                              key={`${i}-${name}`}
                              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-medium bg-white text-indigo-900 border border-indigo-100"
                            >
                              {name}
                              <button
                                type="button"
                                disabled={createSubmitting}
                                onClick={() => {
                                  const next = parseRecruitersInput(formProjectRecruitmentLeads).filter((x) => x !== name);
                                  setFormProjectRecruitmentLeads(next.join('、'));
                                }}
                                className="p-0.5 rounded hover:bg-indigo-50 text-indigo-600"
                                aria-label={`移除 ${name}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <select
                            value={projectLeadPickDept}
                            onChange={(e) => {
                              setProjectLeadPickDept(e.target.value);
                              setProjectLeadPickUsername('');
                            }}
                            disabled={createSubmitting}
                            className="w-full sm:flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                          >
                            <option value="">选择部门</option>
                            {depts.map((d) => (
                              <option key={d.id} value={d.name}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={projectLeadPickUsername}
                            onChange={(e) => setProjectLeadPickUsername(e.target.value)}
                            disabled={createSubmitting || !projectLeadPickDept}
                            className="w-full sm:flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50"
                          >
                            <option value="">{projectLeadPickDept ? '选择招聘经理' : '请先选择部门'}</option>
                            {activeUsersInDept(hrUsers, projectLeadPickDept)
                              .filter((u) => isRecruitingManagerUserRole(u.role))
                              .map((u) => (
                                <option key={u.username} value={u.username}>
                                  {u.name}（{u.username}）
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            disabled={createSubmitting || !projectLeadPickUsername}
                            onClick={() => {
                              const u = hrUsers.find((x) => x.username === projectLeadPickUsername);
                              const n = u?.name?.trim();
                              if (!n) return;
                              const existing = parseRecruitersInput(formProjectRecruitmentLeads);
                              if (existing.some((x) => x.toLowerCase() === n.toLowerCase())) return;
                              setFormProjectRecruitmentLeads([...existing, n].join('、'));
                            }}
                            className="w-full sm:w-auto shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-50 disabled:opacity-50"
                          >
                            添加
                          </button>
                        </div>
                        <textarea
                          value={formProjectRecruitmentLeads}
                          onChange={(e) => setFormProjectRecruitmentLeads(e.target.value)}
                          disabled={createSubmitting}
                          rows={2}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none bg-white"
                          placeholder="也可手填姓名，顿号或逗号分隔"
                        />
                      </div>
                    )}
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
      <JobEditorModal
        jobForm={projectJobForm}
        setJobForm={setProjectJobForm}
        recruiterPickDept={pjRecruiterPickDept}
        setRecruiterPickDept={setPjRecruiterPickDept}
        recruiterPickUsername={pjRecruiterPickUsername}
        setRecruiterPickUsername={setPjRecruiterPickUsername}
        jobFormDepts={depts}
        jobFormUsers={hrUsers}
        selectableProjects={selectableProjectsForJob}
        onSubmit={submitProjectJobForm}
        onClose={() => {
          setProjectJobForm(null);
          setProjectJobLockId(null);
        }}
        projectIdLocked={projectJobLockId}
        recruiterFieldMode="none"
      />
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
      show:
        pendingAiAnalysis > 0 &&
        (currentRole === 'admin' || currentRole === 'recruiter' || currentRole === 'recruiting_manager')
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
      show:
        pendingReviewCount > 0 &&
        (currentRole === 'admin' || currentRole === 'recruiter' || currentRole === 'recruiting_manager')
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
      show:
        pendingInviteCount > 0 &&
        (currentRole === 'admin' || currentRole === 'recruiter' || currentRole === 'recruiting_manager')
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
              recentProjects.map((p) => {
                const leadLine = projectRecruitingLeadDisplay(p);
                return (
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
                        {leadLine !== '—' ? ` · 项目招聘负责人 ${leadLine}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-slate-900 text-white">
                      {p.status || '进行中'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">最近筛查候选人</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">与简历筛查列表一致，登录后展示</p>
            </div>
            {(currentRole === 'admin' ||
              currentRole === 'recruiter' ||
              currentRole === 'recruiting_manager') && (
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

/** 用户管理中的角色是否为「招聘经理」（项目级招聘负责人候选人） */
function isRecruitingManagerUserRole(role: string): boolean {
  const r = String(role || '').trim();
  return /招聘经理|招募经理/i.test(r) || r.toLowerCase() === 'recruiting_manager';
}

/** 一线「招聘人员」（岗位执行人），非经理/交付/管理员 */
function isFrontlineRecruiterStaffRole(role: string): boolean {
  const r = String(role || '').trim();
  if (!r) return false;
  if (/平台管理|系统管理|超级|管理员|交付经理|交付|招聘经理|招募经理/i.test(r)) return false;
  if (/招聘人员|recruiter/i.test(r)) return true;
  return r.includes('招聘') && !r.includes('经理');
}

function namesListContainsIdentity(names: string[] | undefined, profile: AdminLoginProfile | null): boolean {
  const keys = recruiterIdentityKeys(profile);
  if (!keys.length) return false;
  const ns = (names || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  return ns.some((n) => keys.some((k) => k === n));
}

/** 招聘经理：仅当本人出现在项目的「项目招聘负责人」名单中时，可编辑该项目下岗位的招聘人员 */
function recruitingManagerCanEditJob(job: Job, profile: AdminLoginProfile | null, project?: Project | null): boolean {
  if (!project?.id) return false;
  const leads = project.recruitmentLeads;
  if (!leads?.length) return false;
  return namesListContainsIdentity(leads, profile);
}

/** 招聘经理：仅保留本人在「项目招聘负责人」名单中的项目 */
function filterProjectsForRecruitingManagerScope(
  projects: Project[],
  profile: AdminLoginProfile | null
): Project[] {
  return projects.filter(
    (p) =>
      Boolean(p.id) &&
      p.id !== 'EMPTY' &&
      p.id !== 'UNASSIGNED' &&
      namesListContainsIdentity(p.recruitmentLeads, profile)
  );
}

/** 招聘专员：岗位「招聘人员」中含本人姓名或登录账号的岗位码（用于初面管理等与 job_code 对齐） */
function recruiterAssignedJobCodesFromProjects(
  projects: Project[],
  profile: AdminLoginProfile | null
): Set<string> {
  const meKeys = recruiterIdentityKeys(profile);
  const out = new Set<string>();
  if (!meKeys.length) return out;
  for (const p of projects) {
    if (!p?.id || p.id === 'EMPTY') continue;
    for (const job of p.jobs || []) {
      if (recruitersContainMe(job.recruiters, meKeys)) {
        const jc = String(job.id || '').trim();
        if (jc) out.add(jc);
      }
    }
  }
  return out;
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

function JobEditorModal({
  jobForm,
  setJobForm,
  recruiterPickDept,
  setRecruiterPickDept,
  recruiterPickUsername,
  setRecruiterPickUsername,
  jobFormDepts,
  jobFormUsers,
  selectableProjects,
  onSubmit,
  onClose,
  onNavigateResumeScreening,
  projectIdLocked,
  recruiterFieldMode = 'none',
  recruiterStaffOptions = []
}: {
  jobForm: JobFormState | null;
  setJobForm: React.Dispatch<React.SetStateAction<JobFormState | null>>;
  recruiterPickDept: string;
  setRecruiterPickDept: (v: string) => void;
  recruiterPickUsername: string;
  setRecruiterPickUsername: (v: string) => void;
  jobFormDepts: Dept[];
  jobFormUsers: User[];
  selectableProjects: Project[];
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  onNavigateResumeScreening?: () => void;
  projectIdLocked?: string | null;
  /** none：交付经理/管理员；single：招聘经理为每岗指定一名招聘人员；multi：保留多选（一般不用） */
  recruiterFieldMode?: 'none' | 'single' | 'multi';
  /** single 模式下可选的一线招聘人员列表（可跨部门） */
  recruiterStaffOptions?: User[];
}) {
  if (typeof document === 'undefined') return null;
  if (!jobForm) return null;
  const rfMode = recruiterFieldMode ?? 'none';
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="job-form-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-form-title"
        onClick={() => !jobForm.submitting && onClose()}
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
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              aria-label="关闭"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">所属项目</label>
                {projectIdLocked ? (
                  <>
                    <p className="text-sm text-slate-800 font-medium">
                      {selectableProjects.find((p) => p.id === projectIdLocked)?.name || projectIdLocked}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">在当前项目下维护岗位，所属项目不可更改。</p>
                  </>
                ) : (
                  <select
                    value={jobForm.projectId}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, projectId: e.target.value } : f))}
                    disabled={jobForm.submitting || selectableProjects.length === 0}
                    required={selectableProjects.length > 0}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    {selectableProjects.length === 0 ? (
                      <option value="">暂无可用项目，请先在「项目管理」中创建</option>
                    ) : (
                      selectableProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))
                    )}
                  </select>
                )}
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
                    onChange={(e) => setJobForm((f) => (f ? { ...f, department: e.target.value } : f))}
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
                    onChange={(e) => setJobForm((f) => (f ? { ...f, demand: e.target.value } : f))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">地点</label>
                  <input
                    value={jobForm.location}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, location: e.target.value } : f))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="例如：北京"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">薪资范围</label>
                  <input
                    value={jobForm.salary}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, salary: e.target.value } : f))}
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
                    onChange={(e) => setJobForm((f) => (f ? { ...f, level: e.target.value } : f))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="例如：高级"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">技能关键词</label>
                  <input
                    value={jobForm.skills}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, skills: e.target.value } : f))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="例如：React, TypeScript"
                  />
                </div>
              </div>
              {rfMode === 'single' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">招聘人员（每岗仅一人）</label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    由招聘经理指定一名一线招聘人员；列表包含各部门账号，与项目「招聘负责人」配置配合使用。
                  </p>
                  <select
                    value={parseRecruitersInput(jobForm.recruiters)[0] || ''}
                    onChange={(e) =>
                      setJobForm((f) => (f ? { ...f, recruiters: e.target.value.trim() } : f))
                    }
                    disabled={jobForm.submitting}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">未指定</option>
                    {(() => {
                      const sel = parseRecruitersInput(jobForm.recruiters)[0] || '';
                      const inStaff = recruiterStaffOptions.some((u) => u.name.trim() === sel);
                      return sel && !inStaff ? (
                        <option key="__orphan-recruiter" value={sel}>
                          {sel}（当前）
                        </option>
                      ) : null;
                    })()}
                    {recruiterStaffOptions.map((u) => (
                      <option key={u.username} value={u.name.trim()}>
                        {u.name}（{u.username}）
                      </option>
                    ))}
                  </select>
                </div>
              ) : rfMode === 'multi' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">招聘负责人（可见招聘）</label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    先选部门，再选人员并添加；可切换部门多次添加不同部门的负责人。下方可继续用顿号或逗号手填补充。
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.75rem]">
                    {parseRecruitersInput(jobForm.recruiters).map((name, i) => (
                      <span
                        key={`${i}-${name}`}
                        className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-800 border border-indigo-100"
                      >
                        {name}
                        <button
                          type="button"
                          disabled={jobForm.submitting}
                          onClick={() =>
                            setJobForm((f) => {
                              if (!f) return f;
                              const next = parseRecruitersInput(f.recruiters).filter((x) => x !== name);
                              return { ...f, recruiters: next.join('、') };
                            })
                          }
                          className="p-0.5 rounded hover:bg-indigo-100 text-indigo-600 disabled:opacity-50"
                          aria-label={`移除 ${name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 mb-2">
                    <select
                      value={recruiterPickDept}
                      onChange={(e) => {
                        setRecruiterPickDept(e.target.value);
                        setRecruiterPickUsername('');
                      }}
                      disabled={jobForm.submitting}
                      className="w-full sm:flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                    >
                      <option value="">选择部门</option>
                      {jobFormDepts.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={recruiterPickUsername}
                      onChange={(e) => setRecruiterPickUsername(e.target.value)}
                      disabled={jobForm.submitting || !recruiterPickDept}
                      className="w-full sm:flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">{recruiterPickDept ? '选择人员' : '请先选择部门'}</option>
                      {activeUsersInDept(jobFormUsers, recruiterPickDept).map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.name}（{u.username}）
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={jobForm.submitting || !recruiterPickUsername}
                      onClick={() => {
                        const u = jobFormUsers.find((x) => x.username === recruiterPickUsername);
                        const n = u?.name?.trim();
                        if (!n) return;
                        setJobForm((f) => {
                          if (!f) return f;
                          const existing = parseRecruitersInput(f.recruiters);
                          if (existing.some((x) => x.toLowerCase() === n.toLowerCase())) return f;
                          return { ...f, recruiters: [...existing, n].join('、') };
                        });
                      }}
                      className="w-full sm:w-auto shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      添加
                    </button>
                  </div>
                  <textarea
                    value={jobForm.recruiters}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, recruiters: e.target.value } : f))}
                    disabled={jobForm.submitting}
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                    placeholder="张三、李四（顿号或逗号分隔）"
                  />
                </div>
              ) : null}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">职位描述（JD）</label>
                <textarea
                  value={jobForm.jdText}
                  onChange={(e) => setJobForm((f) => (f ? { ...f, jdText: e.target.value } : f))}
                  rows={5}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
                  placeholder="岗位职责与任职要求"
                />
              </div>
              {jobForm.error ? <p className="text-sm text-red-600">{jobForm.error}</p> : null}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex flex-wrap justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={jobForm.submitting}
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white"
              >
                取消
              </button>
              {onNavigateResumeScreening ? (
                <button
                  type="button"
                  disabled={jobForm.submitting}
                  onClick={() => {
                    onClose();
                    onNavigateResumeScreening();
                  }}
                  className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100"
                >
                  去筛简历
                </button>
              ) : null}
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
    </AnimatePresence>,
    document.body
  );
}

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
  const [jobFormDepts, setJobFormDepts] = useState<Dept[]>([]);
  const [jobFormUsers, setJobFormUsers] = useState<User[]>([]);
  const [recruiterPickDept, setRecruiterPickDept] = useState('');
  const [recruiterPickUsername, setRecruiterPickUsername] = useState('');

  const loadData = useCallback(() => {
    void fetch('/api/projects')
      .then((res) => res.json())
      .then((data: Project[]) => {
        if (!Array.isArray(data)) {
          setProjectOptions([]);
          setRows([]);
          return;
        }
        let scoped: Project[] = data;
        if (currentRole === 'delivery_manager') {
          const ud = String(authProfile?.dept || '').trim();
          if (!ud || ud === '-') {
            setProjectOptions([]);
            setRows([]);
            return;
          }
          if (!deliveryManagerHasJobQueryMenu(authProfile)) {
            setProjectOptions([]);
            setRows([]);
            return;
          }
          scoped = filterProjectsForDeliveryManagerScope(data, ud);
        } else if (currentRole === 'recruiting_manager') {
          scoped = filterProjectsForRecruitingManagerScope(data, authProfile);
        }
        setProjectOptions(scoped);
        const out: JobAssignmentRow[] = [];
        const meKeys = recruiterIdentityKeys(authProfile);
        for (const p of scoped) {
          if (p.id === 'EMPTY') continue;
          const pname = p.id === 'UNASSIGNED' ? '未分配项目岗位' : p.name;
          const pm = projectRecruitingLeadDisplay(p);
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
  }, [
    authProfile?.name,
    authProfile?.username,
    authProfile?.dept,
    authProfile?.allowedMenuKeys,
    currentRole
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    void fetch('/api/depts')
      .then((res) => res.json())
      .then((rows: Dept[]) => setJobFormDepts(Array.isArray(rows) ? rows : []))
      .catch(() => setJobFormDepts([]));
  }, []);

  useEffect(() => {
    void fetch('/api/users')
      .then((res) => res.json())
      .then((data: unknown) => setJobFormUsers(usersFromApiPayload(data)))
      .catch(() => setJobFormUsers([]));
  }, []);

  const recruiterStaffOptions = useMemo(
    () => jobFormUsers.filter((u) => isFrontlineRecruiterStaffRole(u.role)),
    [jobFormUsers]
  );

  const selectableProjects = projectOptions.filter((p) => !['EMPTY', 'UNASSIGNED'].includes(p.id));

  const canDeleteInJobQuery = currentRole === 'admin' || currentRole === 'delivery_manager';

  const projectForJobRow = (job: Job): Project | null => {
    const pid = job.project_id;
    if (!pid || pid === 'UNASSIGNED') return null;
    return projectOptions.find((p) => p.id === pid) ?? null;
  };

  const jobQueryCanEditRow = (job: Job) => {
    if (currentRole === 'recruiter') return false;
    if (currentRole === 'recruiting_manager')
      return recruitingManagerCanEditJob(job, authProfile, projectForJobRow(job));
    return true;
  };

  const openCreate = () => {
    if (currentRole === 'recruiter') return;
    const first = selectableProjects[0];
    setRecruiterPickDept('');
    setRecruiterPickUsername('');
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
    if (
      currentRole === 'recruiting_manager' &&
      !recruitingManagerCanEditJob(job, authProfile, projectForJobRow(job))
    ) {
      window.alert(
        '仅可编辑「项目招聘负责人」中包含您本人姓名或登录账号的项目下的岗位；请在「项目管理」中由交付经理/管理员将您设为该项目的招聘负责人。'
      );
      return;
    }
    const firstPid = selectableProjects[0]?.id ?? '';
    let pid = job.project_id === 'UNASSIGNED' || !job.project_id ? '' : job.project_id;
    if (!pid || !selectableProjects.some((p) => p.id === pid)) pid = firstPid;
    setRecruiterPickDept('');
    setRecruiterPickUsername('');
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
    if (selectableProjects.length === 0) {
      setJobForm((f) => (f ? { ...f, error: '暂无可用项目，请先在「项目管理」中创建' } : f));
      return;
    }
    const pidTrim = jobForm.projectId.trim();
    if (!pidTrim) {
      setJobForm((f) => (f ? { ...f, error: '请选择所属项目' } : f));
      return;
    }
    setJobForm((f) => (f ? { ...f, submitting: true, error: '' } : f));
    const recruitersParsed = parseRecruitersInput(jobForm.recruiters);
    const recruitersRm = recruitersParsed.slice(0, 1);
    const demand = Math.max(1, Math.min(99999, Number(jobForm.demand) || 1));
    const projectId = pidTrim;
    const isRm = currentRole === 'recruiting_manager';
    const basePayload: Record<string, unknown> = {
      title,
      projectId,
      department: jobForm.department.trim() || null,
      demand,
      location: jobForm.location.trim() || null,
      skills: jobForm.skills.trim() || null,
      level: jobForm.level.trim() || null,
      salary: jobForm.salary.trim() || null,
      jdText: jobForm.jdText.trim() || null
    };
    try {
      if (jobForm.mode === 'create') {
        const jc = jobForm.jobCode.trim();
        const body: Record<string, unknown> = {
          ...basePayload,
          recruiters: isRm ? recruitersRm : []
        };
        if (jc) body.jobCode = jc.toUpperCase();
        const r = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || `创建失败 ${r.status}`);
      } else {
        const patchBody: Record<string, unknown> = { ...basePayload };
        if (isRm) patchBody.recruiters = recruitersRm;
        const r = await fetch(`/api/jobs/${encodeURIComponent(jobForm.jobCode)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody)
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
          {currentRole === 'recruiting_manager' ? (
            <span className="block mt-1.5 text-slate-500">
              招聘经理仅展示与编辑：本人在「项目招聘负责人」名单中的项目下的岗位；每个岗位可指定一名一线「招聘人员」（单选）。未包含您的项目不会出现在此列表。
            </span>
          ) : null}
          {currentRole === 'delivery_manager' ? (
            <span className="block mt-1.5 text-slate-500">
              交付经理仅展示与本人「所属部门」一致的项目下的岗位；项目招聘负责人在「项目管理」中维护。岗位上的招聘人员由招聘经理在此页为每岗指定一人。未归入项目的岗位不在此列表。
            </span>
          ) : null}
        </p>
      </div>

      {currentRole === 'delivery_manager' &&
      (!String(authProfile?.dept || '').trim() || String(authProfile?.dept || '').trim() === '-') ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 text-amber-950 px-5 py-4 text-sm leading-relaxed max-w-3xl">
          无法列出岗位：账号未设置「所属部门」。请管理员在「用户管理」中填写部门（须与项目部门一致），保存后重新登录。
        </div>
      ) : null}
      {currentRole === 'delivery_manager' && !deliveryManagerHasJobQueryMenu(authProfile) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 text-amber-950 px-5 py-4 text-sm leading-relaxed max-w-3xl">
          当前角色未勾选「岗位分配」菜单，无法在此查看本部门岗位；如需仅维护项目请使用「项目管理」，或在「角色管理」中勾选「岗位分配」。
        </div>
      ) : null}

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
                            {jobQueryCanEditRow(job) ? (
                              <button
                                type="button"
                                onClick={() => openEdit(job)}
                                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                                aria-label="编辑"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            ) : null}
                            {canDeleteInJobQuery ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteJob(job)}
                                className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                aria-label="删除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : null}
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

      <JobEditorModal
        jobForm={jobForm}
        setJobForm={setJobForm}
        recruiterPickDept={recruiterPickDept}
        setRecruiterPickDept={setRecruiterPickDept}
        recruiterPickUsername={recruiterPickUsername}
        setRecruiterPickUsername={setRecruiterPickUsername}
        jobFormDepts={jobFormDepts}
        jobFormUsers={jobFormUsers}
        selectableProjects={selectableProjects}
        onSubmit={submitJobForm}
        onClose={() => setJobForm(null)}
        onNavigateResumeScreening={() => onNavigate('resume-screening')}
        recruiterFieldMode={currentRole === 'recruiting_manager' ? 'single' : 'none'}
        recruiterStaffOptions={recruiterStaffOptions}
      />
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

/** 面试报告 dimensionScores 中英文字段 → 初面管理弹窗展示用中文 */
function interviewReportDimensionLabelCn(key: string): string {
  const k = String(key || '').trim()
  const map: Record<string, string> = {
    communication: '沟通表达',
    technicalDepth: '技术深度',
    technical: '技术深度',
    logic: '逻辑思维',
    jobFit: '岗位匹配',
    stability: '稳定性与抗压',
    skill: '技能匹配',
    experience: '岗位经验',
    education: '学历与资质'
  }
  return map[k] || k
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
  candidate_phone?: string | null
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
    phone: r.candidate_phone != null && String(r.candidate_phone).trim() ? String(r.candidate_phone).trim() : undefined,
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
  const [inviteJobs, setInviteJobs] = useState<
    { job_code: string; title: string; department: string; project_id?: string | null }[]
  >([]);
  const [inviteJobsLoading, setInviteJobsLoading] = useState(false);
  const [screeningProjects, setScreeningProjects] = useState<
    { id: string; name: string; dept?: string; recruitmentLeads?: string[] }[]
  >([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [resumeProjectFilter, setResumeProjectFilter] = useState('');
  const [creatingInvite, setCreatingInvite] = useState<string | null>(null);
  const [inviteBanner, setInviteBanner] = useState('');
  const [inviteModal, setInviteModal] = useState<
    null | { kind: 'success'; inviteCode: string; jobCode: string } | { kind: 'error'; message: string }
  >(null);
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
  const isDeliveryManager = currentRole === 'delivery_manager';
  const isRecruitingManager = currentRole === 'recruiting_manager';
  const recruiterCodeSet = useMemo(() => new Set(recruiterJobCodes), [recruiterJobCodes]);

  const projectFilterOptions = useMemo(() => {
    let base = screeningProjects;
    if (isRecruitingManager) {
      base = base.filter((p) => p.id && namesListContainsIdentity(p.recruitmentLeads, authProfile));
    }
    if (isDeliveryManager) {
      const ud = String(authProfile?.dept || '').trim();
      if (!ud || ud === '-') return [];
      base = base.filter((p) => p.id && deptNamesMatch(ud, String(p.dept || '')));
    }
    if (!isRecruiter) return base;
    const pidSet = new Set(
      inviteJobs.map((j) => String(j.project_id || '').trim()).filter(Boolean)
    );
    if (pidSet.size === 0) return base;
    return base.filter((p) => pidSet.has(p.id));
  }, [
    authProfile,
    isDeliveryManager,
    isRecruiter,
    isRecruitingManager,
    inviteJobs,
    screeningProjects
  ]);

  useEffect(() => {
    setResumeProjectFilter((prev) => {
      if (prev === '_null') return '';
      if (!prev) return prev;
      if (projectFilterOptions.some((p) => p.id === prev)) return prev;
      return '';
    });
  }, [projectFilterOptions]);

  /** 上传区「目标匹配岗位」：随上方项目筛选只展示该项目下的岗位 */
  const jobsForUploadSelect = useMemo(() => {
    const pid = resumeProjectFilter.trim();
    if (!pid) return inviteJobs;
    if (pid === '_null') {
      return inviteJobs.filter((j) => !String(j.project_id ?? '').trim());
    }
    return inviteJobs.filter((j) => String(j.project_id ?? '').trim() === pid);
  }, [inviteJobs, resumeProjectFilter]);

  const loadScreenings = useCallback(() => {
    if (!apiBase || !hasToken) {
      setResumes([]);
      setScreenListError('');
      return;
    }
    setScreenListError('');
    const screeningUrl =
      resumeProjectFilter.trim().length > 0
        ? `/api/admin/resume-screenings?projectId=${encodeURIComponent(resumeProjectFilter.trim())}`
        : '/api/admin/resume-screenings';
    void miniappApiFetch(screeningUrl)
      .then(async (r) => {
        const j = (await r.json()) as { data?: unknown[]; message?: string }
        if (!r.ok) throw new Error(j.message || 'load failed');
        const rows = (j.data || []) as Array<{
          id: number | string
          job_code: string
          candidate_name: string
          candidate_phone?: string | null
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
        const allowDmJobs = new Set(
          inviteJobs.map((j) => String(j.job_code || '').trim()).filter(Boolean)
        );
        let list = mapped;
        if (isRecruiter) {
          list = mapped.filter((x) => x.jobCode && recruiterCodeSet.has(String(x.jobCode)));
        } else if (isDeliveryManager) {
          if (allowDmJobs.size === 0) list = [];
          else list = mapped.filter((x) => x.jobCode && allowDmJobs.has(String(x.jobCode)));
        } else if (isRecruitingManager) {
          if (allowDmJobs.size === 0) list = [];
          else list = mapped.filter((x) => x.jobCode && allowDmJobs.has(String(x.jobCode)));
        }
        setResumes(list);
      })
      .catch(() => {
        setResumes([]);
        setScreenListError('筛查记录暂时无法加载，请稍后重试或联系管理员检查系统是否已升级、网络是否正常。');
      });
  }, [
    apiBase,
    hasToken,
    isRecruiter,
    isDeliveryManager,
    isRecruitingManager,
    inviteJobs,
    recruiterCodeSet,
    sessRev,
    resumeProjectFilter
  ]);

  useEffect(() => {
    loadScreenings();
  }, [loadScreenings]);

  useEffect(() => {
    if (!apiBase || !hasToken) {
      setScreeningProjects([]);
      return;
    }
    setProjectsLoading(true);
    void miniappApiFetch('/api/admin/projects')
      .then(async (r) => {
        const j = (await r.json()) as { data?: { id: string; name?: string }[]; message?: string };
        if (!r.ok) throw new Error(j.message || 'load projects failed');
        const list = (j.data || []).map((p) => {
          const row = p as {
            id?: unknown;
            name?: unknown;
            dept?: unknown;
            recruitmentLeads?: unknown;
          };
          const lr = row.recruitmentLeads;
          const recruitmentLeads = Array.isArray(lr)
            ? lr.map((x) => String(x || '').trim()).filter(Boolean)
            : [];
          return {
            id: String(row.id || ''),
            name: String(row.name || row.id || '').trim() || String(row.id || ''),
            dept: row.dept != null ? String(row.dept) : '',
            recruitmentLeads
          };
        });
        setScreeningProjects(list.filter((x) => x.id));
      })
      .catch(() => setScreeningProjects([]))
      .finally(() => setProjectsLoading(false));
  }, [apiBase, hasToken, sessRev]);

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
          data?: { job_code: string; title: string; department: string; project_id?: string | null }[];
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
        let scoped = all;
        if (isRecruiter) {
          scoped = all.filter((x) => recruiterCodeSet.has(String(x.job_code)));
        } else if (isRecruitingManager) {
          const allowed = new Set(
            screeningProjects
              .filter((p) => p.id && namesListContainsIdentity(p.recruitmentLeads, authProfile))
              .map((p) => p.id)
          );
          scoped =
            allowed.size === 0
              ? []
              : all.filter((x) => allowed.has(String(x.project_id ?? '').trim()));
        } else if (isDeliveryManager) {
          const ud = String(authProfile?.dept || '').trim();
          if (!ud || ud === '-') {
            scoped = [];
          } else {
            let plist = screeningProjects;
            if (plist.length === 0) {
              try {
                const pr = await miniappApiFetch('/api/admin/projects');
                const pj = (await pr.json()) as {
                  data?: { id?: unknown; name?: unknown; dept?: unknown }[];
                  message?: string;
                };
                if (pr.ok && Array.isArray(pj.data)) {
                  plist = pj.data.map((p) => ({
                    id: String(p.id || ''),
                    name: String(p.name || p.id || '').trim() || String(p.id || ''),
                    dept: p.dept != null ? String(p.dept) : ''
                  }));
                  setScreeningProjects(plist.filter((x) => x.id));
                } else {
                  plist = [];
                }
              } catch {
                plist = [];
              }
            }
            const allowed = new Set(
              plist.filter((p) => p.id && deptNamesMatch(ud, String(p.dept || ''))).map((p) => p.id)
            );
            scoped = all.filter((x) => allowed.has(String(x.project_id ?? '').trim()));
          }
        }
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
  }, [
    apiBase,
    hasToken,
    isRecruiter,
    isDeliveryManager,
    isRecruitingManager,
    authProfile,
    authProfile?.dept,
    screeningProjects,
    recruiterCodeSet,
    sessRev
  ]);

  useEffect(() => {
    if (jobsForUploadSelect.length === 0) {
      setSelectedJobCode('');
      return;
    }
    setSelectedJobCode((prev) => {
      if (prev && jobsForUploadSelect.some((j) => j.job_code === prev)) return prev;
      return jobsForUploadSelect[0].job_code;
    });
  }, [jobsForUploadSelect]);

  const handleMiniappInvite = async (jobCode: string, screeningId?: string) => {
    setInviteModal(null);
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
        setInviteModal({
          kind: 'success',
          inviteCode: j.data.inviteCode,
          jobCode: j.data.jobCode || jobCode
        });
        setInviteBanner('');
        loadScreenings();
      }
    } catch (e) {
      setInviteModal({ kind: 'error', message: e instanceof Error ? e.message : '发起面试失败' });
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
      setInviteModal({
        kind: 'error',
        message: '该简历未标注匹配岗位，请联系管理员补充岗位关联后再发起面试。'
      });
      return;
    }
    const matched =
      inviteJobs.find((j) => j.job_code === name) ||
      inviteJobs.find((j) => j.title === name) ||
      inviteJobs.find((j) => name.includes(j.title) || j.title.includes(name));
    if (!matched) {
      setInviteModal({
        kind: 'error',
        message: `未在可操作岗位中找到与「${name}」对应的岗位，请联系管理员确认岗位分配。`
      });
      return;
    }
    void handleMiniappInvite(matched.job_code, resume.id);
  };

  const runUpload = (file: File | null) => {
    if (!file || !apiBase || !hasToken) return;
    if (!selectedJobCode) {
      setUploadHint(
        jobsForUploadSelect.length === 0 && resumeProjectFilter.trim()
          ? '当前项目下没有可选岗位，请更换项目或为岗位绑定项目后再试。'
          : '请先选择目标岗位。'
      );
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
      {inviteBanner ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">{inviteBanner}</div>
      ) : null}
      {isRecruiter && !recruiterScopeLoading && recruiterJobCodes.length === 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          当前账号未分配可操作岗位，请联系管理员在岗位分配中添加您的岗位负责人配置。
        </div>
      ) : null}
      {isRecruitingManager && !inviteJobsLoading && inviteJobs.length === 0 && hasToken ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          当前账号未被设为任何项目的「项目招聘负责人」，因此没有可选项目与岗位。请交付经理或管理员在「项目管理」中将您加入对应项目的「项目招聘负责人」。
        </div>
      ) : null}
      <div className="space-y-6">
        {/* Upload Area */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col">
            <h3 className="font-bold text-slate-900 mb-4">上传简历进行 AI 筛查</h3>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              系统会从简历正文中自动识别候选人姓名与手机号（大模型 + 文本规则）；识别成功则写入筛查记录，识别不到则仅保存姓名推断结果，不强制填写。
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">项目筛选</label>
              <select
                value={resumeProjectFilter}
                onChange={(e) => setResumeProjectFilter(e.target.value)}
                disabled={
                  !apiBase ||
                  !hasToken ||
                  projectsLoading ||
                  recruiterScopeLoading ||
                  (isDeliveryManager &&
                    (!String(authProfile?.dept || '').trim() || String(authProfile?.dept || '').trim() === '-'))
                }
                className="w-full border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-900 disabled:bg-slate-100"
              >
                <option value="">
                  {isDeliveryManager ? '本部门全部项目' : isRecruitingManager ? '我的负责项目（全部）' : '全部项目'}
                </option>
                {projectFilterOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                {isDeliveryManager ? (
                  <>
                    交付经理仅可选择与本人「所属部门」一致的项目；未选具体项目时，岗位与筛查记录也仅限本部门项目范围。
                  </>
                ) : isRecruitingManager ? (
                  <>
                    招聘经理仅可选择本人为「项目招聘负责人」的项目；未选具体项目时，岗位与下方 AI
                    筛查结果也仅限这些项目下的岗位。
                  </>
                ) : (
                  <>选择项目后，下方「目标匹配岗位」仅展示该项目下的岗位；下方筛查结果列表也会按同一项目过滤。</>
                )}
              </p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">目标匹配岗位</label>
              <select
                value={selectedJobCode}
                onChange={(e) => setSelectedJobCode(e.target.value)}
                disabled={
                  !jobsForUploadSelect.length || inviteJobsLoading || recruiterScopeLoading || !inviteJobs.length
                }
                className="w-full border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none text-sm disabled:bg-slate-100"
              >
                {!inviteJobs.length ? (
                  <option value="">暂无可用岗位，请联系管理员在系统中维护岗位信息</option>
                ) : jobsForUploadSelect.length === 0 ? (
                  <option value="">当前项目下暂无岗位，请更换项目或绑定岗位到项目</option>
                ) : (
                  jobsForUploadSelect.map((j) => (
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
            <div className="p-6 border-b border-slate-100 flex flex-row items-center justify-between gap-3">
              <h3 className="font-bold text-slate-900">AI 筛查结果</h3>
              <span className="text-sm text-slate-500 shrink-0">当前列表 {resumes.length} 条</span>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-4">
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
                  {resumeProjectFilter.trim()
                    ? '当前项目筛选下暂无记录，可切换项目或从左侧上传简历；若确认应有数据，请检查岗位是否已绑定到该项目。'
                    : '暂无筛查记录。请从左侧上传简历；若长期无数据，请联系管理员确认系统是否正常。'}
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
                    {resume.phone ? (
                      <div className="text-sm text-slate-600 mt-0.5">手机：{resume.phone}</div>
                    ) : null}
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
        {inviteModal ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-modal-title"
            onClick={() => setInviteModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
                <h3
                  id="invite-modal-title"
                  className={`text-lg font-bold ${inviteModal.kind === 'success' ? 'text-emerald-900' : 'text-slate-900'}`}
                >
                  {inviteModal.kind === 'success' ? '面试邀请已生成' : '无法发起面试'}
                </h3>
                <button
                  type="button"
                  onClick={() => setInviteModal(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="关闭"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4">
                {inviteModal.kind === 'success' ? (
                  <>
                    <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                      邀请码格式为「岗位编号-发起人账号-简历筛查记录编号」。请将下方邀请码发给候选人；对方在小程序「欢迎参加面试」页填写真实姓名与邀请码即可（姓名需与筛查记录一致，便于关联报告）。
                    </p>
                    <p className="text-xs text-slate-500 mb-2">岗位码 {inviteModal.jobCode}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <code className="text-lg font-mono bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                        {inviteModal.inviteCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyInviteCode(inviteModal.inviteCode)}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        复制邀请码
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-700 leading-relaxed">{inviteModal.message}</p>
                )}
              </div>
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-xl flex justify-end">
                <button
                  type="button"
                  onClick={() => setInviteModal(null)}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  知道了
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
    /** 面试进度说明（邀请/报告/会话等） */
    interviewSituation: string
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
  const isAdminRole = currentRole === 'admin'
  const userDept = String(authProfile?.dept || '').trim()
  const deptScoped = Boolean(userDept && userDept !== '-')

  const loadRows = useCallback(() => {
    setLoading(true)
    setErr('')
    void Promise.all([miniappApiFetch('/api/admin/resume-screenings'), fetch('/api/projects')])
      .then(async ([screeningRes, projectsRes]) => {
        const j = (await screeningRes.json()) as { data?: unknown[]; message?: string }
        if (!screeningRes.ok) throw new Error(j.message || `加载失败 ${screeningRes.status}`)
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
            const { flowStage } = deriveScreeningFlowLabels(row as Record<string, unknown>)
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
              interviewSituation: deriveInterviewSituation(row as Record<string, unknown>, hasInterviewReport)
            }
          })
        if (isAdminRole) {
          setRows(mapped)
          return
        }
        const projectsPayload = projectsRes.ok
          ? ((await projectsRes.json().catch(() => [])) as unknown)
          : []
        const allProjects: Project[] = Array.isArray(projectsPayload) ? projectsPayload : []
        if (currentRole === 'recruiting_manager') {
          const leadProjects = filterProjectsForRecruitingManagerScope(allProjects, authProfile)
          const leadJobCodes = new Set<string>()
          for (const p of leadProjects) {
            for (const job of p.jobs || []) {
              const jc = String(job.id || '').trim()
              if (jc) leadJobCodes.add(jc)
            }
          }
          setRows(
            mapped.filter((x) => {
              const jc = String(x.jobCode || '').trim()
              return Boolean(jc && leadJobCodes.has(jc))
            })
          )
          return
        }
        if (currentRole === 'recruiter') {
          const myJobCodes = recruiterAssignedJobCodesFromProjects(allProjects, authProfile)
          setRows(
            mapped.filter((x) => {
              const jc = String(x.jobCode || '').trim()
              return Boolean(jc && myJobCodes.has(jc))
            })
          )
          return
        }
        if (currentRole !== 'delivery_manager') {
          setRows([])
          return
        }
        const scopedProjects =
          deptScoped ? filterProjectsForDeliveryManagerScope(allProjects, userDept) : []
        const deptJobCodes = new Set<string>()
        for (const p of scopedProjects) {
          for (const job of p.jobs || []) {
            const jc = String(job.id || '').trim()
            if (jc) deptJobCodes.add(jc)
          }
        }
        const list = !deptScoped
          ? []
          : mapped.filter((x) => {
              const jc = String(x.jobCode || '').trim()
              return Boolean(jc && deptJobCodes.has(jc))
            })
        setRows(list)
      })
      .catch((e: unknown) => {
        setRows([])
        setErr(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => setLoading(false))
  }, [authProfile, currentRole, deptScoped, isAdminRole, userDept])

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
      {!isAdminRole && !deptScoped ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          无法按部门筛选初面数据：账号未设置「所属部门」。请管理员在「用户管理」中填写部门（须与项目上的部门名称一致），保存后重新登录。
        </div>
      ) : null}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50 space-y-4">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-slate-900">初面管理</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
                一条记录对应一次简历筛查。<span className="font-medium text-slate-600">平台管理员</span>始终查看全部筛查记录；<span className="font-medium text-slate-600">招聘经理</span>仅展示本人在「项目招聘负责人」中的项目下的岗位所对应的记录；<span className="font-medium text-slate-600">招聘专员</span>仅展示「岗位分配」中将自己设为该岗位「招聘人员」的岗位所对应的记录（姓名或登录账号须与本人一致）；<span className="font-medium text-slate-600">交付经理</span>按本人「所属部门」在项目中的岗位（岗位码）筛选。
                <span className="font-medium text-slate-600">流程阶段</span>随漏斗推进：筛查完成 → 从筛查页「发起面试」后为已发邀请 → 候选人完成面试并生成报告后为初面结果。
                面试报告按岗位码 + 姓名关联；综合分有报告时显示面试分，否则为简历匹配分。
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
              <th className="px-6 py-4 font-medium">流程阶段</th>
              <th className="px-6 py-4 font-medium min-w-[200px]">面试情况</th>
              <th className="px-6 py-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td className="px-6 py-8 text-slate-500" colSpan={7}>加载中...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td className="px-6 py-8 text-slate-500" colSpan={7}>暂无数据，请先在简历筛查上传简历</td></tr>
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
                    <td className="px-6 py-4">
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
                      <div className="text-slate-500">{interviewReportDimensionLabelCn(k)}</div>
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

function mapDeptRow(r: Record<string, unknown>): Dept {
  return {
    id: String(r.id ?? ''),
    parentId: r.parent_id != null && String(r.parent_id).trim() ? String(r.parent_id) : null,
    name: String(r.name ?? ''),
    level: Number(r.level) || 0,
    manager: String(r.manager ?? '-'),
    count: Number(r.count) || 0
  };
}

/** 按 parent_id 建树后深度优先展开；无 parent_id 的老数据按 level+名称排序为顶级 */
function flattenDeptTree(depts: Dept[]): { dept: Dept; depth: number }[] {
  const byParent = new Map<string, Dept[]>();
  for (const d of depts) {
    const pid = d.parentId || '';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(d);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      const la = Number(a.level) || 0;
      const lb = Number(b.level) || 0;
      if (la !== lb) return la - lb;
      return String(a.name).localeCompare(String(b.name), 'zh-CN');
    });
  }
  const roots = (byParent.get('') || []).length
    ? byParent.get('')!
    : [...depts].sort((a, b) => {
        const la = Number(a.level) || 0;
        const lb = Number(b.level) || 0;
        if (la !== lb) return la - lb;
        return String(a.name).localeCompare(String(b.name), 'zh-CN');
      });
  const out: { dept: Dept; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (d: Dept, depth: number) => {
    if (visited.has(d.id)) return;
    visited.add(d.id);
    out.push({ dept: d, depth });
    const kids = byParent.get(d.id) || [];
    for (const c of kids) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  const orphans = depts.filter((d) => !visited.has(d.id));
  orphans.sort((a, b) => {
    const la = Number(a.level) || 0;
    const lb = Number(b.level) || 0;
    if (la !== lb) return la - lb;
    return String(a.name).localeCompare(String(b.name), 'zh-CN');
  });
  for (const o of orphans) out.push({ dept: o, depth: 0 });
  return out;
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
  const [formName, setFormName] = useState('');
  const [formLevel, setFormLevel] = useState('0');
  const [formManager, setFormManager] = useState('');
  const [formCount, setFormCount] = useState('0');
  const [hrUsers, setHrUsers] = useState<User[]>([]);

  const deptById = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);

  const deptManagerSelectValue = useMemo(() => {
    const m = formManager.trim();
    if (!m || m === '-') return '';
    const matches = hrUsers.filter((u) => u.status === '正常' && u.name === m);
    return matches.length === 1 ? matches[0].username : '';
  }, [formManager, hrUsers]);

  const deptFormUsersSorted = useMemo(() => {
    return [...hrUsers.filter((u) => u.status === '正常')].sort((a, b) => {
      const da = String(a.dept || '').localeCompare(String(b.dept || ''), 'zh-CN');
      if (da !== 0) return da;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });
  }, [hrUsers]);

  const displayRows = useMemo(() => {
    const flat = flattenDeptTree(depts);
    const qq = q.trim().toLowerCase();
    if (!qq) return flat;
    return flat.filter(
      ({ dept }) =>
        String(dept.name || '').toLowerCase().includes(qq) ||
        String(dept.manager || '').toLowerCase().includes(qq) ||
        String(dept.id || '').toLowerCase().includes(qq)
    );
  }, [depts, q]);

  const openCreate = () => {
    setDialog({ mode: 'create' });
    setFormName('');
    setFormLevel('0');
    setFormManager('');
    setFormCount('0');
  };

  const openChild = (parent: Dept) => {
    setDialog({ mode: 'child', parent });
    setFormName('');
    setFormManager('');
    setFormCount('0');
  };

  const openEdit = (d: Dept) => {
    setDialog({ mode: 'edit', record: d });
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
      const [deptRows, userPayload] = await Promise.all([
        adminFetchJson<Array<Record<string, unknown>>>('/api/depts'),
        adminFetchJson<unknown>('/api/users')
      ]);
      setDepts(deptRows.map(mapDeptRow));
      setHrUsers(usersFromApiPayload(userPayload));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setDepts([]);
      setHrUsers([]);
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
      const manager = formManager.trim() || '-';
      const count = Number(formCount) || 0;
      if (dialog.mode === 'edit' && dialog.record) {
        const level = Number(formLevel) || 0;
        await adminFetchJson(`/api/depts/${encodeURIComponent(dialog.record.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            level: Math.max(0, Math.min(99, level)),
            manager,
            count
          })
        });
      } else {
        const body: Record<string, unknown> = { name, manager, count };
        if (dialog.mode === 'child' && dialog.parent) {
          body.parentId = dialog.parent.id;
        } else {
          body.level = 0;
        }
        await adminFetchJson<{ id: string }>('/api/depts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
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

  const dialogTitle =
    dialog?.mode === 'edit'
      ? '编辑部门'
      : dialog?.mode === 'child'
        ? `新增子部门 — 上级：${dialog.parent?.name || '—'}`
        : '新增顶级部门';

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500 max-w-3xl leading-relaxed">
        上下级通过 <span className="font-mono text-slate-600">parent_id</span> 关联：点「新增子部门」会关联上级部门，层级由系统自动计算；部门编号由系统生成。若保存提示缺少列，请在库{' '}
        <span className="font-mono">ai_recruit_admin</span> 执行{' '}
        <span className="font-mono">server/migration_depts_parent_id.sql</span>。
      </p>
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索部门、负责人或编号…"
            className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-80 max-w-full focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> 新增顶级部门
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
        ) : displayRows.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">{q.trim() ? '无匹配部门' : '暂无部门数据'}</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-6 py-4 font-medium">部门名称</th>
                <th className="px-6 py-4 font-medium">部门编号</th>
                <th className="px-6 py-4 font-medium">负责人</th>
                <th className="px-6 py-4 font-medium">成员数量</th>
                <th className="px-6 py-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayRows.map(({ dept, depth }) => (
                <tr key={dept.id} className="hover:bg-slate-50 transition-colors">
                  <td
                    className="px-6 py-4 font-medium text-slate-900"
                    style={{ paddingLeft: `${depth * 1.5 + 1.5}rem` }}
                  >
                    <div className="flex items-center gap-2">
                      {depth > 0 ? <span className="text-slate-300 select-none">└</span> : null}
                      <Network className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span>{dept.name}</span>
                      <span className="text-xs font-normal text-slate-400">L{dept.level}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{dept.id}</td>
                  <td className="px-6 py-4 text-slate-600">{dept.manager}</td>
                  <td className="px-6 py-4 text-slate-600">{dept.count} 人</td>
                  <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openChild(dept)}
                      className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                    >
                      新增子部门
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
              ))}
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
        {dialog?.mode === 'child' && dialog.parent ? (
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600">
            上级部门：<span className="font-medium text-slate-800">{dialog.parent.name}</span>
            <span className="text-slate-500"> · 保存后层级 = {Number(dialog.parent.level) + 1}</span>
          </div>
        ) : null}
        {dialog?.mode === 'edit' && dialog.record?.parentId ? (
          <p className="text-[11px] text-slate-500">
            上级：
            {deptById.get(dialog.record.parentId)?.name || dialog.record.parentId}
            （子部门层级请在库中通过调整上级关系维护，此处可改数字层级作校正）
          </p>
        ) : null}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">部门名称</label>
          <input className={systemFieldClass} value={formName} onChange={(e) => setFormName(e.target.value)} />
        </div>
        {dialog?.mode === 'edit' ? (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">层级数字（与列表排序相关，一般与树深度一致）</label>
            <input
              type="number"
              min={0}
              max={99}
              className={systemFieldClass}
              value={formLevel}
              onChange={(e) => setFormLevel(e.target.value)}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {dialog?.mode === 'child'
              ? '子部门层级由系统根据上级自动写入，无需手填。'
              : '顶级部门层级固定为 0。'}
          </p>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">成员数量（展示用）</label>
          <input
            type="number"
            min={0}
            className={systemFieldClass}
            value={formCount}
            onChange={(e) => setFormCount(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">负责人</label>
          <p className="text-[11px] text-slate-400 mb-1.5">
            可从用户管理中的在职账号选择（写入姓名），也可在下方直接填写或修改。
          </p>
          <select
            className={systemFieldClass}
            value={deptManagerSelectValue}
            onChange={(e) => {
              const un = e.target.value;
              if (!un) {
                setFormManager('');
                return;
              }
              const u = hrUsers.find((x) => x.username === un && x.status === '正常');
              if (u?.name) setFormManager(u.name);
            }}
            disabled={saving}
          >
            <option value="">从用户列表选择…</option>
            {deptFormUsersSorted.map((u) => (
              <option key={u.username} value={u.username}>
                {u.name}（{u.username}）{u.dept && u.dept !== '-' ? ` · ${u.dept}` : ''}
              </option>
            ))}
          </select>
          <input
            className={`${systemFieldClass} mt-2`}
            value={formManager === '-' ? '' : formManager}
            onChange={(e) => setFormManager(e.target.value)}
            placeholder="负责人姓名，留空则保存为未指定"
          />
        </div>
      </SystemCrudModal>
    </div>
  );
}

function SystemUserView({
  currentRole,
  authProfile
}: {
  currentRole: Role;
  authProfile: AdminLoginProfile | null;
}) {
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
  const [ufName, setUfName] = useState('');
  const [ufUsername, setUfUsername] = useState('');
  const [ufDept, setUfDept] = useState('');
  const [ufRole, setUfRole] = useState('');
  const [ufStatus, setUfStatus] = useState<'正常' | '停用'>('正常');
  const [ufPassword, setUfPassword] = useState('');

  const myDept = String(authProfile?.dept || '').trim();
  const myDeptOk = Boolean(myDept && myDept !== '-');
  /** 平台管理员始终可查看与维护全部用户；其他角色仅本部门 */
  const listAllUsers = currentRole === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userRows, deptRows, roleRows] = await Promise.all([
        adminFetchJson<User[]>('/api/users'),
        adminFetchJson<Dept[]>('/api/depts'),
        adminFetchJson<Array<Record<string, unknown>>>('/api/roles')
      ]);
      const ud = String(authProfile?.dept || '').trim();
      const udOk = Boolean(ud && ud !== '-');
      const showAll = currentRole === 'admin';
      const scopedUsers = showAll
        ? userRows
        : udOk
          ? userRows.filter((u) => deptNamesMatch(ud, String(u.dept || '')))
          : [];
      setUsers(scopedUsers);
      const names = [...new Set(deptRows.map((d) => String(d.name || '')).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'zh-CN')
      );
      const formDeptNames = showAll ? names : udOk ? names.filter((n) => deptNamesMatch(ud, n)) : names;
      setDeptNames(udOk && !showAll && formDeptNames.length === 0 && ud ? [ud] : formDeptNames);
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
  }, [authProfile?.dept, currentRole]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!listAllUsers) setDeptFilter('');
  }, [listAllUsers]);

  const openUserCreate = () => {
    setUserDialog({ mode: 'create' });
    setUfName('');
    setUfUsername('');
    setUfDept(listAllUsers ? '' : myDeptOk && deptNames.includes(myDept) ? myDept : deptNames[0] || '');
    setUfRole(roleOptions[0]?.name || '招聘人员');
    setUfStatus('正常');
    setUfPassword('');
  };

  const openUserEdit = (u: User) => {
    setUserDialog({ mode: 'edit', user: u });
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
    if (!listAllUsers && myDeptOk && !deptNamesMatch(myDept, dept)) {
      setError('仅能维护与本人「所属部门」一致的用户');
      return;
    }
    if (!ufDept.trim()) {
      setError('请选择所属部门');
      return;
    }
    const unErr = loginUsernameErrorForRole(username, role);
    if (unErr) {
      setError(unErr);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">用户管理</h1>
        <p className="text-xs text-slate-500 mt-2 max-w-3xl leading-relaxed">
          {listAllUsers
            ? '平台管理员可查看与维护全部用户（与本人是否配置「所属部门」无关）。'
            : '仅展示与当前登录账号「所属部门」一致的用户；其他部门人员不在此列表。新建用户时部门限定在本部门范围内。'}
        </p>
      </div>
      {!listAllUsers && !myDeptOk ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          无法按部门列出用户：账号未设置「所属部门」。请超级管理员在「用户管理」中为您填写部门（须与「部门管理」中名称一致），保存后重新登录。
        </div>
      ) : null}
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
          {listAllUsers ? (
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
          ) : null}
        </div>
        <button
          type="button"
          onClick={openUserCreate}
          disabled={!listAllUsers && !myDeptOk}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 disabled:pointer-events-none"
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
          <div className="py-16 text-center text-slate-500 text-sm">
            {q.trim() || (listAllUsers && deptFilter)
              ? '无匹配用户'
              : listAllUsers
                ? '暂无用户数据'
                : myDeptOk
                  ? '本部门暂无用户'
                  : '暂无用户数据'}
          </div>
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
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">姓名</label>
          <input className={systemFieldClass} value={ufName} onChange={(e) => setUfName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            {roleAllowsNonMobileLoginUsername(ufRole) ? '登录账号' : '登录账号（手机号）'}
          </label>
          <p className="text-[11px] text-slate-400 mb-1.5">
            {roleAllowsNonMobileLoginUsername(ufRole)
              ? '平台管理员等可使用字母/数字账号（如 admin）。'
              : '新增用户请使用 11 位中国大陆手机号作为登录名，与员工手机号一致。'}
          </p>
          <input
            type={roleAllowsNonMobileLoginUsername(ufRole) ? 'text' : 'tel'}
            className={systemFieldClass}
            value={ufUsername}
            onChange={(e) => setUfUsername(e.target.value)}
            autoComplete="off"
            inputMode={roleAllowsNonMobileLoginUsername(ufRole) ? 'text' : 'numeric'}
            maxLength={roleAllowsNonMobileLoginUsername(ufRole) ? 64 : 11}
            placeholder={
              roleAllowsNonMobileLoginUsername(ufRole) ? '例如 admin' : '例如 13800138000'
            }
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">所属部门</label>
          <select
            className={systemFieldClass}
            value={deptNames.includes(ufDept) ? ufDept : ufDept ? `__other:${ufDept}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('__other:')) setUfDept(v.slice('__other:'.length));
              else setUfDept(v);
            }}
            disabled={saving || (!listAllUsers && myDeptOk && deptNames.length <= 1)}
          >
            <option value="">请选择部门</option>
            {deptNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            {ufDept.trim() && !deptNames.includes(ufDept) ? (
              <option value={`__other:${ufDept}`}>{ufDept}（当前值，不在部门列表中）</option>
            ) : null}
          </select>
          {deptNames.length === 0 ? (
            <p className="text-[11px] text-amber-700 mt-1.5">
              暂无部门数据，请先在「部门管理」中新增部门后再创建用户。
            </p>
          ) : null}
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

function mapRoleMenuKeysFromRow(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw == null || raw === '') return null;
  try {
    let p: unknown;
    if (Array.isArray(raw)) {
      p = raw;
    } else if (typeof raw === 'string') {
      p = JSON.parse(raw) as unknown;
    } else {
      return null;
    }
    if (!Array.isArray(p)) return null;
    return p.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function SystemRoleView() {
  const [roles, setRoles] = useState<SysRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<null | { mode: 'create' | 'edit'; role?: SysRole }>(null);
  const [saving, setSaving] = useState(false);
  const [rfName, setRfName] = useState('');
  const [rfDesc, setRfDesc] = useState('');
  const [rfUsers, setRfUsers] = useState('0');
  const [rfMenuMode, setRfMenuMode] = useState<'inherit' | 'custom'>('inherit');
  const [rfMenuChecked, setRfMenuChecked] = useState<Set<string>>(() => new Set());

  const allMenuIds = useMemo(
    () => ADMIN_ROLE_MENU_OPTIONS.flatMap((g) => g.items.map((i) => i.id)),
    []
  );

  const toggleRfMenuKey = (id: string) => {
    setRfMenuChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await adminFetchJson<Array<Record<string, unknown>>>('/api/roles');
      const mapped: SysRole[] = rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        desc: String(r.desc ?? ''),
        users: Number(r.users) || 0,
        menuKeys: mapRoleMenuKeysFromRow((r as Record<string, unknown>).menu_keys)
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
    setRfName('');
    setRfDesc('');
    setRfUsers('0');
    setRfMenuMode('inherit');
    setRfMenuChecked(new Set(allMenuIds));
  };

  const openEdit = (r: SysRole) => {
    setDialog({ mode: 'edit', role: r });
    setRfName(r.name);
    setRfDesc(r.desc);
    setRfUsers(String(r.users));
    if (r.menuKeys === undefined || r.menuKeys === null) {
      setRfMenuMode('inherit');
      setRfMenuChecked(new Set(allMenuIds));
    } else {
      setRfMenuMode('custom');
      setRfMenuChecked(new Set(r.menuKeys));
    }
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
      const menuPayload =
        rfMenuMode === 'inherit'
          ? { menuKeys: null as null }
          : { menuKeys: Array.from(rfMenuChecked) };
      if (dialog.mode === 'edit' && dialog.role) {
        await adminFetchJson(`/api/roles/${encodeURIComponent(dialog.role.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, desc: rfDesc.trim(), users, ...menuPayload })
        });
      } else {
        const createBody: Record<string, unknown> = {
          name,
          desc: rfDesc.trim(),
          users
        };
        if (rfMenuMode === 'custom') {
          createBody.menuKeys = Array.from(rfMenuChecked);
        }
        await adminFetchJson<{ id: string }>('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody)
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
                <th className="px-6 py-4 font-medium">菜单权限</th>
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
                  <td className="px-6 py-4 text-slate-600">
                    {role.menuKeys === undefined || role.menuKeys === null ? (
                      <span className="text-xs text-slate-500">职级默认</span>
                    ) : role.menuKeys.length === 0 ? (
                      <span className="text-xs text-amber-700">已限制（0 项）</span>
                    ) : (
                      <span className="text-xs text-indigo-700">自定义 {role.menuKeys.length} 项</span>
                    )}
                  </td>
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
        <div className="border-t border-slate-100 pt-4 mt-2">
          <p className="text-xs font-semibold text-slate-700 mb-2">可见菜单（与左侧导航一致）</p>
          <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
            用户管理里「角色」字段须与本角色<strong>名称完全一致</strong>，登录后才会套用此处配置。选择「跟随职级默认」时不写入限制，侧边栏仅按账号职级（管理员/交付/招聘）显示。
          </p>
          <div className="flex flex-col gap-2 mb-3">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="radio"
                name="rfMenuMode"
                checked={rfMenuMode === 'inherit'}
                onChange={() => setRfMenuMode('inherit')}
                className="rounded-full border-slate-300"
              />
              跟随职级默认（不在库中单独限制菜单）
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="radio"
                name="rfMenuMode"
                checked={rfMenuMode === 'custom'}
                onChange={() => {
                  setRfMenuMode('custom');
                  setRfMenuChecked((prev) => (prev.size ? prev : new Set(allMenuIds)));
                }}
                className="rounded-full border-slate-300"
              />
              自定义可见菜单（与职级权限求交）
            </label>
          </div>
          {rfMenuMode === 'custom' ? (
            <div className="space-y-3 max-h-48 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/80 p-3">
              {ADMIN_ROLE_MENU_OPTIONS.map((g) => (
                <div key={g.group}>
                  <p className="text-[11px] font-medium text-slate-500 mb-1.5">{g.group}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {g.items.map((it) => (
                      <label key={it.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rfMenuChecked.has(it.id)}
                          onChange={() => toggleRfMenuKey(it.id)}
                          className="rounded border-slate-300"
                        />
                        {it.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
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
      setMenus(rows.map(mapMenuRow));
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

  const menuDisplayRows = useMemo(
    () => flattenMenuTreeForDisplay(filterMenusForSearchTree(menus, q)),
    [menus, q]
  );

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
    setMfName('');
    setMfType('菜单');
    setMfIcon('Briefcase');
    setMfPath('/');
    setMfLevel('0');
  };

  const openChild = (parent: Menu) => {
    setDialog({ mode: 'child', parent });
    setMfName('');
    setMfType('菜单');
    setMfIcon('Briefcase');
    setMfPath(suggestedChildMenuPath(parent));
    setMfLevel(String((Number(parent.level) || 0) + 1));
  };

  const openEdit = (m: Menu) => {
    setDialog({ mode: 'edit', record: m });
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
        const body: Record<string, unknown> = { ...payload };
        if (dialog.mode === 'child' && dialog.parent?.id) {
          body.parentId = dialog.parent.id;
        }
        await adminFetchJson<{ id: string }>('/api/menus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
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

  const dialogTitle =
    dialog?.mode === 'edit' ? '编辑菜单' : dialog?.mode === 'child' ? '添加下级菜单' : '新增菜单';

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950 leading-relaxed">
        <p className="font-semibold text-indigo-900 mb-1">说明</p>
        <p>
          左侧导航<strong>实际显示哪些菜单</strong>由「角色管理」中各角色的<strong>可见菜单</strong>配置（写入{' '}
          <code className="text-xs bg-white/80 px-1 rounded">roles.menu_keys</code>
          ）与账号<strong>职级</strong>共同决定：仅勾选且职级允许的项会显示。本页维护菜单树与路由路径元数据；目录下新增子菜单依赖库表{' '}
          <code className="text-xs bg-white/80 px-1 rounded">menus.parent_id</code>
          ，若列表无法树形展开或保存报错，请在管理库执行{' '}
          <span className="font-mono text-xs">server/migration_menus_parent_id.sql</span>。
        </p>
      </div>
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
        ) : menuDisplayRows.length === 0 ? (
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
              {menuDisplayRows.map(({ menu, depth }) => (
                <tr key={menu.id} className="hover:bg-slate-50 transition-colors">
                  <td
                    className="px-6 py-4 font-medium text-slate-900"
                    style={{ paddingLeft: `${depth * 2 + 1.5}rem` }}
                  >
                    <div className="flex items-center gap-2">
                      {depth > 0 ? <span className="w-4 h-px bg-slate-300 inline-block mr-1"></span> : null}
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
              ))}
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
        {dialog?.mode === 'child' && dialog.parent ? (
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600">
            上级菜单：<span className="font-medium text-slate-800">{dialog.parent.name}</span>
            <span className="text-slate-500"> · 保存后将挂在此目录下；层级由后台按上级自动计算。</span>
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
              className={`${systemFieldClass} ${dialog?.mode === 'child' ? 'bg-slate-50 text-slate-500' : ''}`}
              value={mfLevel}
              onChange={(e) => setMfLevel(e.target.value)}
              readOnly={dialog?.mode === 'child'}
              title={dialog?.mode === 'child' ? '添加下级时由系统根据上级计算' : undefined}
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
          <p className="text-[11px] text-slate-400 mb-1.5 leading-relaxed">
            建议与模块 URL 前缀一致：如 <span className="font-mono">/projects/list</span>、
            <span className="font-mono">/recruitment/resume</span>、<span className="font-mono">/system/users</span> 等。左侧实际高亮与跳转由代码中的菜单 id（如{' '}
            <span className="font-mono">project-list</span>）与角色可见菜单配置决定，此处 path 主要作分层展示与文档对照。
          </p>
          <input className={systemFieldClass} value={mfPath} onChange={(e) => setMfPath(e.target.value)} />
        </div>
      </SystemCrudModal>
    </div>
  );
}
