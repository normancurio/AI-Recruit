import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
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
  STANDARD_JOB_LEVELS,
  STANDARD_JOB_ROLE_BASES,
  normalizeJobLevel,
  normalizeJobTitle,
  matchRoleBaseFromJobTitle,
  composeStandardJobTitle,
  normalizeExtractedJobTitleForDisplay,
  jobLevelValidationMessage,
  jobRoleBaseValidationMessage
} from '../shared/jobTaxonomy';
import { 
  Building2, Briefcase, Users, FileText, UserCheck, 
  Settings, Network, UserCog, Shield, Menu as MenuIcon,
  Search, Plus, UploadCloud, BrainCircuit, ChevronDown,
  ChevronRight, ChevronLeft, MoreHorizontal, CheckCircle2, XCircle,
  LogOut, Bell, LayoutDashboard, FolderOpen, Bot,
  Clock, Calendar, Pencil, Trash2, Loader2, KeyRound, Sparkles, UserRound, Lock, X, RotateCcw
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
  return '招聘专员'
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
      { id: 'resume-screening', label: '简历管理' },
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

/** 登录后统一：主按钮靛蓝实心，次要按钮白底描边深字 */
const btnPrimaryLg =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-55'
const btnPrimaryMd =
  'rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60'
const btnPrimaryIcon =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50'
const btnSecondarySm =
  'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50'
const btnSaveSm =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50'
const btnPrimarySmFlex =
  'inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:pointer-events-none disabled:opacity-50'

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
        title: '简历管理',
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
  /** 同人主档 resume_candidates.id，按规范化手机号归并；无手机号或未迁移时可能为空 */
  candidateId?: string
  name: string
  /** 上传时填写的手机号，存于 resume_screenings.candidate_phone */
  phone?: string
  /** 上传该简历筛查记录的后台登录账号 */
  uploaderUsername?: string
  job: string
  jobCode?: string
  matchScore: number
  skillScore?: number
  experienceScore?: number
  educationScore?: number
  stabilityScore?: number
  /** AI 对简历给出的结论文案（如 AI分析完成、待定） */
  status: string
  /** 招聘漏斗阶段：简历筛查完成 / 已发邀请 / AI面试完成 等 */
  flowStage?: string
  uploadTime: string
  reportSummary?: string
  /** 原始上传文件名 */
  fileName?: string
  /** 后端是否已保存原始简历文件，可用于预览/下载 */
  hasOriginalFile?: boolean
  /** 简历正文截取（接口返回库中正文前段；列表中不展开，在「查看简历」弹框中阅读） */
  resumePlainPreview?: string
  evaluationJson?: {
    decision?: string
    summary?: string
    strengths?: string[]
    risks?: Array<string | { risk?: string; interview_question?: string }>
    dimension_scores?: Record<string, number | { score?: number; evidence?: string[] }>
  }
  /** 简历结构化维度分，优先取 evaluation_json.dimension_scores（六维） */
  resumeDimensionScores?: Record<string, number>
  /** 列表筛选用：evaluation_json.candidate_profile 中常见字段 */
  candidateFilterFields?: {
    gender: string
    education: string
    hasDegree: boolean | null
    isUnified: boolean | null
    verifiable: boolean | null
    recruitmentChannel: string
    expectedSalary: string
  }
}
export interface Application { id: string; name: string; job: string; resumeScore: number; interviewScore: number; aiEval: string; status: string; }
export interface Dept {
  id: string;
  name: string;
  /** 业务类型：交付 / 招聘 / 其他；「招聘」可出现在项目招聘负责人选部门中 */
  deptType?: string;
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

/** 从若干根部门 id 向下收集自身及所有子部门 id（依据 parentId） */
function collectDescendantDeptIds(depts: Dept[], rootIds: string[]): Set<string> {
  const byParent = new Map<string, Dept[]>();
  for (const d of depts) {
    const pid = d.parentId || '';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(d);
  }
  const out = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (!id || out.has(id)) continue;
    out.add(id);
    for (const c of byParent.get(id) || []) stack.push(c.id);
  }
  return out;
}

/**
 * 创建/编辑项目等场景：非管理员仅展示账号所属部门及其下级部门（与 depts 树一致）。
 * 若组织树中无与账号部门名匹配的记录，则退化为单条账号部门名，避免无法提交。
 */
function deliveryManagerDeptSubtree(depts: Dept[], userDept: string): Dept[] {
  const ud = String(userDept || '').trim();
  if (!ud || ud === '-') return [];
  const roots = depts.filter((d) => deptNamesMatch(ud, d.name));
  if (!roots.length) {
    return [{ id: '__account_dept__', name: ud, deptType: '', level: 0, manager: '-', count: 0, parentId: null }];
  }
  const allowed = collectDescendantDeptIds(depts, roots.map((r) => r.id));
  return flattenDeptTree(depts)
    .map(({ dept }) => dept)
    .filter((d) => allowed.has(d.id));
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

/** 用户「所属部门」是否落在给定部门子树内（按部门名称与树节点 name 匹配） */
function userDeptInSubtree(userDept: string, subtreeDepts: Dept[]): boolean {
  const d = String(userDept || '').trim();
  if (!d || d === '-') return false;
  return subtreeDepts.some((sd) => deptNamesMatch(d, sd.name));
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

/** 非管理员在「用户管理」弹窗中可选的角色名（与 roles.name 一致） */
function roleNameAllowedInUserDialogForCreator(creatorRole: Role, roleName: string): boolean {
  if (creatorRole === 'admin') return true;
  const n = String(roleName || '').trim();
  if (creatorRole === 'delivery_manager') return n === '交付经理';
  if (creatorRole === 'recruiting_manager') {
    return n === '招聘经理' || n === '招聘人员' || n === '招聘专员';
  }
  if (creatorRole === 'recruiter') {
    return n === '招聘人员' || n === '招聘专员';
  }
  return true;
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
      setHrCaptchaEnabled(false);
      return;
    }
    const base = miniappApiBase.replace(/\/$/, '');
    void fetch(`${base}/api/admin/auth-status`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ passwordLogin?: boolean; captchaEnabled?: boolean }>
      })
      .then((j) => {
        setHrApiPasswordLogin(Boolean(j.passwordLogin));
        setHrCaptchaEnabled(Boolean(j.captchaEnabled));
      })
      .catch(() => {
        setHrApiPasswordLogin(null);
        setHrCaptchaEnabled(false);
      });
  }, [miniappApiBase]);
  const showHrApiLogin = Boolean(miniappApiBase) && !hasAdminApiCredentials();
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  /** 与 auth-status.captchaEnabled 一致：已配 Redis 时须图形验证码 */
  const [hrCaptchaEnabled, setHrCaptchaEnabled] = useState(false);
  const [loginCaptchaId, setLoginCaptchaId] = useState('');
  const [loginCaptchaSvg, setLoginCaptchaSvg] = useState('');
  const [loginCaptchaInput, setLoginCaptchaInput] = useState('');

  const refreshLoginCaptcha = useCallback(async () => {
    if (!miniappApiBase || !hrCaptchaEnabled) return;
    const base = miniappApiBase.replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/api/admin/captcha`);
      const j = (await r.json().catch(() => ({}))) as {
        message?: string
        data?: { captchaId?: string; svg?: string }
      };
      if (!r.ok) {
        setLoginCaptchaId('');
        setLoginCaptchaSvg('');
        setLoginCaptchaInput('');
        return;
      }
      setLoginCaptchaId(String(j.data?.captchaId || ''));
      setLoginCaptchaSvg(String(j.data?.svg || ''));
      setLoginCaptchaInput('');
    } catch {
      setLoginCaptchaId('');
      setLoginCaptchaSvg('');
    }
  }, [miniappApiBase, hrCaptchaEnabled]);

  useEffect(() => {
    if (!showHrApiLogin || !hrCaptchaEnabled) return;
    void refreshLoginCaptcha();
  }, [showHrApiLogin, hrCaptchaEnabled, refreshLoginCaptcha]);

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(min-width: 768px)').matches) {
      setMobileNavOpen(true);
    }
  }, []);

  const navigateMenu = useCallback((id: string) => {
    setActiveMenu(id);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setMobileNavOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    if (!isMobile) {
      return () => window.removeEventListener('keydown', onKey);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  const submitHrLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr('');
    if (hrCaptchaEnabled && (!loginCaptchaId.trim() || !loginCaptchaInput.trim())) {
      setLoginErr('请填写图形验证码');
      return;
    }
    setLoginLoading(true);
    try {
      const base = miniappApiBase.replace(/\/$/, '');
      const r = await fetch(`${base}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUser.trim(),
          password: loginPass,
          ...(hrCaptchaEnabled
            ? { captchaId: loginCaptchaId.trim(), captchaCode: loginCaptchaInput.trim() }
            : {})
        })
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
      setLoginCaptchaInput('');
      if (hrCaptchaEnabled) void refreshLoginCaptcha();
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : '登录失败');
      if (hrCaptchaEnabled) void refreshLoginCaptcha();
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
                    className={btnSecondarySm}
                  >
                    关闭
                  </button>
                  <button
                    type="submit"
                    disabled={changePwdLoading}
                    className={btnSaveSm}
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
        <div className="min-h-screen relative flex flex-col overflow-hidden bg-slate-950 text-slate-50">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="absolute -top-40 right-[-10%] h-[28rem] w-[28rem] rounded-full bg-indigo-600/25 blur-3xl" />
            <div className="absolute bottom-[-20%] left-[-10%] h-[22rem] w-[22rem] rounded-full bg-violet-600/20 blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0)_0%,rgba(15,23,42,0.65)_100%)]" />
          </div>
          <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
            <div className="w-full max-w-[400px] space-y-8">
              <div className="text-center space-y-3">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-900/40 ring-1 ring-white/20">
                  <BrainCircuit className="h-9 w-9" aria-hidden />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[1.65rem]">智能招聘系统</h1>
                </div>
              </div>
              <form
                onSubmit={submitHrLogin}
                className="rounded-2xl border border-white/10 bg-white/[0.97] p-7 shadow-2xl shadow-black/25 backdrop-blur-md sm:p-8 space-y-5 ring-1 ring-black/5"
              >
                <div className="border-b border-slate-100 pb-4">
                  <h2 className="text-lg font-semibold text-slate-900">账号登录</h2>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="hr-login-username" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    登录账号
                  </label>
                  <div className="relative">
                    <UserRound
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      id="hr-login-username"
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      autoComplete="username"
                      inputMode="text"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="请输入手机号"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="hr-login-password" className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    密码
                  </label>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      id="hr-login-password"
                      type="password"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="请输入密码"
                    />
                  </div>
                </div>
                {hrCaptchaEnabled ? (
                  <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="hr-login-captcha" className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        图形验证码
                      </label>
                      <button
                        type="button"
                        disabled={loginLoading}
                        onClick={() => void refreshLoginCaptcha()}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                      >
                        换一张
                      </button>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      {loginCaptchaSvg ? (
                        <div className="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                          <img
                            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(loginCaptchaSvg)}`}
                            alt="验证码"
                            className="block h-11 w-[132px]"
                          />
                        </div>
                      ) : (
                        <div className="flex h-11 w-[132px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-xs text-slate-400">
                          加载中…
                        </div>
                      )}
                      <input
                        id="hr-login-captcha"
                        value={loginCaptchaInput}
                        onChange={(e) => setLoginCaptchaInput(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="characters"
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm uppercase text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="右侧字符，不区分大小写"
                        maxLength={8}
                      />
                    </div>
                  </div>
                ) : null}
                {loginErr ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-100 bg-red-50/95 px-3.5 py-2.5 text-sm leading-relaxed text-red-900"
                  >
                    {loginErr}
                  </div>
                ) : null}
                {hrApiPasswordLogin === false ? (
                  <div className="rounded-xl border border-amber-200/90 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-950">
                    <p className="mb-1 font-medium">暂时无法在此登录</p>
                    <p className="text-amber-900/95">
                      招聘相关服务尚未就绪，请联系技术或运维检查后台与登录配置；也可向管理员确认账号是否已开通。
                    </p>
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={
                    loginLoading ||
                    !loginUser.trim() ||
                    !loginPass ||
                    (hrCaptchaEnabled && (!loginCaptchaId.trim() || !loginCaptchaInput.trim()))
                  }
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:from-indigo-500 hover:to-violet-500 disabled:pointer-events-none disabled:opacity-50"
                >
                  {loginLoading ? '登录中…' : '进入系统'}
                </button>
              </form>
              <p className="text-center text-xs leading-relaxed text-slate-500">
                登录成功后进入您有权限的首个功能页
              </p>
            </div>
          </main>
        </div>
      ) : (
      <div className="min-h-screen min-h-[100dvh] bg-slate-50 flex">
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-20 bg-slate-900/50 md:bg-transparent md:pointer-events-none"
          role="presentation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-[100dvh] w-64 max-w-[min(100vw,16rem)] flex-col bg-slate-900 text-slate-300 shadow-xl transition-transform duration-200 ease-out ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 md:h-16 shrink-0 flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-4 md:px-6">
          <div className="flex min-w-0 flex-1 items-center">
            <BrainCircuit className="mr-2 h-6 w-6 shrink-0 text-indigo-400 md:mr-3" />
            <span className="truncate text-base font-bold tracking-wide text-white md:text-lg">智能招聘系统</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={() => setMobileNavOpen(false)}
            aria-label="关闭菜单"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain py-4">
          {navConfig.map((nav) => (
            <div key={nav.id} className="mb-1">
              {nav.children ? (
                <>
                  <button
                    type="button"
                    onClick={() => toggleMenu(nav.id)}
                    className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-slate-800 hover:text-white md:px-6"
                  >
                    <div className="flex items-center gap-3">
                      {nav.icon}
                      <span className="font-medium">{nav.title}</span>
                    </div>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expandedMenus.includes(nav.id) ? 'rotate-180' : ''}`} />
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
                            type="button"
                            key={child.id}
                            onClick={() => navigateMenu(child.id)}
                            className={`flex w-full items-center gap-3 py-2.5 pl-12 pr-4 text-sm transition-colors md:pl-14 md:pr-6 ${
                              activeMenu === child.id ? 'bg-indigo-500/10 font-medium text-indigo-400' : 'hover:bg-slate-800 hover:text-white'
                            }`}
                          >
                            {child.icon || <div className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
                            {child.title}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => navigateMenu(nav.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 transition-colors md:px-6 ${
                    activeMenu === nav.id
                      ? 'border-r-2 border-indigo-400 bg-indigo-500/10 text-indigo-400'
                      : 'hover:bg-slate-800 hover:text-white'
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

      <main className="flex min-h-0 min-w-0 min-h-[100dvh] flex-1 flex-col overflow-hidden md:min-h-screen">
        <header className="z-10 flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:px-5 sm:py-3 md:h-16 md:flex-row md:items-center md:justify-between md:gap-4 md:px-8 md:py-0">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="shrink-0 rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              onClick={() => setMobileNavOpen(true)}
              aria-label="打开菜单"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-base font-bold text-slate-800 sm:text-lg md:flex-none md:text-xl">
              {navConfig.flatMap((n) => (n.children ? [n, ...n.children] : [n])).find((n) => n.id === activeMenu)?.title ||
                '招聘管理'}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-3 md:gap-x-4 lg:gap-6">
            {authProfile ? (
              <span className="max-w-[11rem] truncate text-xs text-slate-500 sm:max-w-none sm:text-sm">
                当前身份：<span className="font-medium text-slate-700">{roleFallbackLabel(currentRole)}</span>
              </span>
            ) : (
              <span className="text-xs leading-snug text-slate-500 sm:text-sm">
                未登录时按「招聘专员」菜单展示
                <span className="hidden sm:inline">（或环境令牌）</span>
              </span>
            )}
            <div className="hidden h-6 w-px bg-slate-200 sm:block" />
            {authTick >= 0 && miniappApiBase && hasAdminApiCredentials() && authProfile ? (
              <button
                type="button"
                onClick={openChangePassword}
                className="flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 sm:text-sm"
              >
                <KeyRound className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">修改密码</span>
              </button>
            ) : null}
            {authTick >= 0 && miniappApiBase && hasAdminApiCredentials() ? (
              <button
                type="button"
                onClick={() => logoutAdminMiniappAuth()}
                className="flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 sm:text-sm"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">退出登录</span>
              </button>
            ) : null}
            <button type="button" className="relative shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <Bell className="h-5 w-5" />
              <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full border-2 border-white bg-red-500" />
            </button>
            <div className="flex min-w-0 max-w-[40%] cursor-pointer items-center gap-1.5 sm:max-w-none sm:gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                {currentRole === 'admin'
                  ? 'A'
                  : currentRole === 'delivery_manager'
                    ? 'D'
                    : currentRole === 'recruiting_manager'
                      ? 'M'
                      : 'R'}
              </div>
              <span className="truncate text-xs font-medium text-slate-700 sm:text-sm">
                {authProfile?.name ?? roleFallbackLabel(currentRole)}
              </span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50/50 p-4 sm:p-6 lg:p-8">
          <motion.div
            key={activeMenu}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-auto max-w-7xl"
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
        <button type="button" className={btnPrimarySmFlex}>
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
      .then((rows: unknown) =>
        setDepts(Array.isArray(rows) ? (rows as Record<string, unknown>[]).map(mapDeptRow) : [])
      )
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
    if ((role === 'admin' || role === 'delivery_manager') && parseRecruitersInput(formProjectRecruitmentLeads).length === 0) {
      setCreateError('请至少选择 1 位项目招聘负责人');
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

  const scopedDeptsForProjectForm = useMemo(
    () => deliveryManagerDeptSubtree(depts, dmUserDept),
    [depts, dmUserDept]
  );

  const projectFormDeptOptions = useMemo(() => {
    if (role === 'admin') return depts;
    const base = scopedDeptsForProjectForm;
    const cur = formDept.trim();
    if (!cur) return base;
    if (base.some((d) => deptNamesMatch(cur, d.name))) return base;
    const hit = depts.find((d) => deptNamesMatch(cur, d.name));
    if (hit) return [hit, ...base.filter((d) => d.id !== hit.id)];
    return [{ id: '__edit_dept__', name: cur, deptType: '', level: 0, manager: '-', count: 0, parentId: null }, ...base];
  }, [role, depts, scopedDeptsForProjectForm, formDept]);

  const jobFormDeptOptions = useMemo(
    () => (role === 'admin' ? depts : scopedDeptsForProjectForm),
    [role, depts, scopedDeptsForProjectForm]
  );

  const projectRecruitmentLeadDeptOptions = useMemo(
    () => recruitmentDeptOptionsForProjectLeads(depts, dmUserDept, role),
    [depts, dmUserDept, role]
  );
  const projectRecruitmentLeadGroups = useMemo(() => {
    return projectRecruitmentLeadDeptOptions
      .map((d) => {
        const managers = activeUsersInDept(hrUsers, d.name)
          .filter((u) => isRecruitingManagerUserRole(u.role))
          .filter((u) => String(u.name || '').trim())
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
        return { dept: d, managers };
      })
      .filter((g) => g.managers.length > 0);
  }, [hrUsers, projectRecruitmentLeadDeptOptions]);
  const selectedProjectLeads = useMemo(
    () => parseRecruitersInput(formProjectRecruitmentLeads),
    [formProjectRecruitmentLeads]
  );
  const toggleProjectLead = (name: string, checked: boolean) => {
    const n = String(name || '').trim();
    if (!n) return;
    const existing = parseRecruitersInput(formProjectRecruitmentLeads);
    const next = checked
      ? existing.some((x) => x.toLowerCase() === n.toLowerCase())
        ? existing
        : [...existing, n]
      : existing.filter((x) => x.toLowerCase() !== n.toLowerCase());
    setFormProjectRecruitmentLeads(next.join('、'));
  };

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
      roleBase: '',
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
      roleBase: matchRoleBaseFromJobTitle(job.title, job.level) ?? '',
      projectId: pid,
      department: job.department && job.department !== '-' ? job.department : '',
      demand: String(job.demand ?? 1),
      location: job.location && job.location !== '-' ? job.location : '',
      skills: job.skills && job.skills !== '见 JD' ? job.skills : '',
      level: normalizeJobLevel(job.level) ?? '',
      salary: job.salary && job.salary !== '面议' ? job.salary : '',
      recruiters: job.recruiters?.length ? job.recruiters.join('、') : '',
      jdText: job.jdText || ''
    });
  };

  const submitProjectJobForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectJobForm) return;
    const levelNorm = normalizeJobLevel(projectJobForm.level);
    if (!levelNorm) {
      setProjectJobForm((f) =>
        f ? { ...f, error: projectJobForm.level.trim() ? jobLevelValidationMessage() : '请选择级别' } : f
      );
      return;
    }
    const roleBaseNorm = normalizeJobTitle(projectJobForm.roleBase);
    if (!roleBaseNorm || !composeStandardJobTitle(levelNorm, roleBaseNorm)) {
      setProjectJobForm((f) =>
        f
          ? {
              ...f,
              error: projectJobForm.roleBase.trim() ? jobRoleBaseValidationMessage() : '请选择岗位'
            }
          : f
      );
      return;
    }
    const composedTitle = composeStandardJobTitle(levelNorm, roleBaseNorm)!;
    if (!projectJobForm.location.trim()) {
      setProjectJobForm((f) => (f ? { ...f, error: '请填写工作地点' } : f));
      return;
    }
    if (!projectJobForm.salary.trim()) {
      setProjectJobForm((f) => (f ? { ...f, error: '请填写薪资范围' } : f));
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
      title: composedTitle,
      projectId,
      department: projectJobForm.department.trim() || null,
      demand,
      location: projectJobForm.location.trim() || null,
      skills: projectJobForm.skills.trim() || null,
      level: levelNorm,
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
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManage && dmDeptReady ? (
            <button
              type="button"
              onClick={openCreateModal}
              className={btnPrimaryLg}
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
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-indigo-800 text-white">
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
                              className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
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
                              <div className="flex flex-col sm:flex-row sm:items-start gap-3 lg:shrink-0 lg:max-w-[52%]">
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
                                <div className="min-w-0 text-left sm:text-right">
                                  <div className="text-xs text-slate-500 mb-1">可见招聘人员</div>
                                  <div className="flex flex-wrap gap-1 sm:justify-end">
                                    {(job.recruiters || []).map((r) => (
                                      <span
                                        key={r}
                                        className="max-w-full truncate px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-md border border-indigo-100"
                                        title={r}
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
              <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-lg font-bold text-slate-900 shrink-0">
                  {editingProjectId ? '编辑项目' : '创建新招聘项目'}
                </h3>
                  {createError ? (
                    <p className="text-sm text-red-600 min-w-0 flex-1" role="alert">
                      {createError}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={createSubmitting}
                  onClick={closeProjectModal}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
                  aria-label="关闭"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={submitCreate} className="flex flex-col flex-1 min-h-0">
                <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">项目编号</label>
                    <input
                      value={formId}
                      readOnly
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono bg-slate-50 text-slate-600 outline-none cursor-default focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
                      placeholder="PRJ-2024-001"
                      aria-readonly="true"
                    />
                  </div>
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
                      {projectFormDeptOptions.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(role === 'admin' || role === 'delivery_manager') && (
                      <div className="sm:col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-3 space-y-2">
                        <label className="block text-xs font-medium text-slate-700">
                          项目招聘负责人（招聘经理）<span className="text-red-500 ml-1">*</span>
                        </label>
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-indigo-100 bg-white p-2">
                          {projectRecruitmentLeadGroups.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-slate-500">
                              暂无可选招聘经理，请先在「部门管理」中维护类型为「招聘」的部门，并在该部门下创建「招聘经理」角色账号。
                            </p>
                          ) : (
                            projectRecruitmentLeadGroups.map((g) => (
                              <div key={g.dept.id} className="mb-2 last:mb-0 rounded-md border border-slate-100">
                                <div className="px-2.5 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50/60 border-b border-indigo-100">
                                  {g.dept.name}
                                </div>
                                <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {g.managers.map((u) => {
                                    const checked = selectedProjectLeads.some(
                                      (x) => x.toLowerCase() === String(u.name || '').trim().toLowerCase()
                                    );
                                    return (
                                      <label
                                        key={`${g.dept.id}-${u.username}`}
                                        className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={createSubmitting}
                                          onChange={(e) => toggleProjectLead(String(u.name || ''), e.target.checked)}
                                          className="rounded border-slate-300"
                                        />
                                        <span>
                                {u.name}（{u.username}）
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                          {selectedProjectLeads.map((name, i) => (
                            <span
                              key={`${i}-${name}`}
                              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-medium bg-white text-indigo-900 border border-indigo-100"
                            >
                              {name}
                              <button
                                type="button"
                                disabled={createSubmitting}
                                onClick={() => toggleProjectLead(name, false)}
                                className="p-0.5 rounded hover:bg-indigo-50 text-indigo-600"
                                aria-label={`移除 ${name}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
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
                </div>
                <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/80 rounded-b-2xl">
                  <button
                    type="button"
                    disabled={createSubmitting}
                    onClick={closeProjectModal}
                    className={btnSecondarySm}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={createSubmitting}
                    className={btnPrimaryMd}
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
        jobFormDepts={jobFormDeptOptions}
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
      cta: '去简历管理处理',
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
      icon: Users,
      iconWrap: 'bg-emerald-100 text-emerald-600',
      displayValue:
        !hasToken ? '—' : wbStatsLoading ? '…' : wbStatsOk && resumeReceivedCount !== null ? String(resumeReceivedCount) : '—'
    },
    {
      key: 'ai',
      label: '面试报告',
      icon: Bot,
      iconWrap: 'bg-violet-100 text-violet-600',
      displayValue:
        !hasToken ? '—' : wbStatsLoading ? '…' : wbStatsOk && aiInterviewCount !== null ? String(aiInterviewCount) : '—'
    },
    {
      key: 'hire',
      label: '面试通过',
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
                  <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-800 text-white">
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
            </div>
            {(currentRole === 'admin' ||
              currentRole === 'recruiter' ||
              currentRole === 'recruiting_manager') && (
              <button
                type="button"
                onClick={() => onNavigate('resume-screening')}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                简历管理
              </button>
            )}
          </div>
          <div className="p-4 space-y-3">
            {!hasToken ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">请登录后查看最近管理记录</p>
            ) : wbStatsLoading ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">加载中…</p>
            ) : recentCandidates.length === 0 ? (
              <p className="text-sm text-slate-500 px-2 py-6 text-center">暂无记录，可在「简历管理」中上传简历</p>
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
                  <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-800 text-white">
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
  projectDept: string;
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

/**
 * 「招聘部门」展示用：根据岗位已选「招聘人员」在用户表中的所属部门聚合（与「所选项目上负责本岗位招聘的成员所在部门」一致）。
 * 若名单为空或未匹配到用户，返回空串；列表在「未分配招聘专员」时不回落 jobs.department，直接留空。
 */
function departmentsFromJobRecruiters(job: Job, users: User[]): string {
  const tokens = (job.recruiters || [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (!tokens.length) return '';
  const depts = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const u = users.find((x) => {
      if (x.status && x.status !== '正常') return false;
      const name = String(x.name || '').trim().toLowerCase();
      const un = String(x.username || '').trim().toLowerCase();
      return name === lower || un === lower;
    });
    const d = String(u?.dept || '').trim();
    if (d && d !== '-') depts.add(d);
  }
  return [...depts].sort((a, b) => a.localeCompare(b, 'zh-CN')).join('、');
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

/** 招聘经理在岗位分配里指定执行人：仅允许角色为「招聘专员」的账号（不可选招聘经理等） */
function isRecruitingSpecialistStaffRole(role: string): boolean {
  const r = String(role || '').trim();
  if (!r) return false;
  if (isRecruitingManagerUserRole(r)) return false;
  if (r === '招聘专员' || r.toLowerCase() === 'recruiting_specialist') return true;
  return /招聘专员/.test(r) && !/经理/.test(r);
}

function recruitingSpecialistsInDept(users: User[], deptName: string): User[] {
  const d = deptName.trim();
  if (!d) return [];
  return users.filter(
    (u) =>
      u.status === '正常' &&
      u.dept &&
      u.dept !== '-' &&
      deptNamesMatch(u.dept, d) &&
      isRecruitingSpecialistStaffRole(u.role)
  );
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

/** 从岗位标题前缀推断标准级别（如「初级 JAVA…」→ 初级） */
function inferStandardJobLevelFromTitle(title: string): (typeof STANDARD_JOB_LEVELS)[number] | null {
  const t = String(title || '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!t) return null;
  for (const lv of STANDARD_JOB_LEVELS) {
    if (t.startsWith(lv)) return lv;
  }
  return null;
}

type StandardJobLevelResolved = (typeof STANDARD_JOB_LEVELS)[number]

/** 批量 PATCH：尽量得到「级别+标准序列」展示名；兼容大小写/无空格等历史标题 */
function tryComposeBatchJobTitle(job: Job, levelNorm: StandardJobLevelResolved): string | null {
  const uniq: string[] = []
  const push = (s: string) => {
    const t = String(s || '').trim()
    if (t && !uniq.includes(t)) uniq.push(t)
  }
  push(job.title)
  push(normalizeExtractedJobTitleForDisplay(job.title))
  for (const tit of uniq) {
    const rb =
      matchRoleBaseFromJobTitle(tit, job.level) || matchRoleBaseFromJobTitle(tit, levelNorm);
    const rbn = rb ? normalizeJobTitle(rb) : null;
    if (rbn) {
      const c = composeStandardJobTitle(levelNorm, rbn);
      if (c) return c;
    }
  }
  const compact = uniq
    .map((s) => s.replace(/\s/g, '').toLowerCase())
    .find(Boolean);
  if (!compact) return null;
  for (const b of [...STANDARD_JOB_ROLE_BASES].sort((a, c) => c.length - a.length)) {
    if (compact === b.replace(/\s/g, '').toLowerCase()) {
      const c = composeStandardJobTitle(levelNorm, b);
      if (c) return c;
    }
  }
  return null;
}

/**
 * 与编辑弹窗保存逻辑尽量一致，供招聘经理批量覆盖「招聘人员」时组装 PATCH 体。
 * 对历史非标标题（如 java开发工程师、无级别列）做回退，避免无法组装。
 */
function buildRecruitingManagerJobPatchPayload(job: Job, recruitersParsed: string[]): Record<string, unknown> | null {
  const levelClean = String(job.level || '')
    .trim()
    .replace(/^[—\-–]+$/u, '');
  let levelNorm = normalizeJobLevel(levelClean);
  if (!levelNorm) levelNorm = inferStandardJobLevelFromTitle(job.title);
  /** 库中 level 空且标题无职级前缀时，与 PATCH「级别必填」对齐（仅批量分配场景） */
  if (!levelNorm) levelNorm = '中级';

  let titleNorm: string | null =
    tryComposeBatchJobTitle(job, levelNorm) ||
    normalizeJobTitle(job.title) ||
    normalizeJobTitle(normalizeExtractedJobTitleForDisplay(job.title));
  if (!titleNorm) return null;

  const pidTrim =
    job.project_id && job.project_id !== 'UNASSIGNED' && job.project_id !== 'EMPTY'
      ? String(job.project_id).trim()
      : '';
  if (!pidTrim) return null;
  const department = job.department && job.department !== '-' ? String(job.department).trim() : '';
  const demand = Math.max(1, Math.min(99999, Number(job.demand) || 1));
  const location = job.location && job.location !== '-' ? String(job.location).trim() : '';
  const skills = job.skills && job.skills !== '见 JD' ? String(job.skills).trim() : '';
  const salary = job.salary && job.salary !== '面议' ? String(job.salary).trim() : '';
  if (!location || !salary) return null;
  const jdText = String(job.jdText ?? '').trim();
  return {
    title: titleNorm,
    projectId: pidTrim,
    department: department || null,
    demand,
    location,
    skills: skills || null,
    level: levelNorm,
    salary,
    jdText: jdText || null,
    recruiters: recruitersParsed
  };
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

function deliveryManagersByProjectDept(projectDept: string, users: User[]): string {
  const dept = String(projectDept || '').trim();
  if (!dept || dept === '-') return '—';
  const matched = users.filter((u) => {
    const role = String(u.role || '').trim().toLowerCase();
    const isDeliveryManager = role === 'delivery_manager' || String(u.role || '').includes('交付经理');
    if (!isDeliveryManager) return false;
    if (!deptNamesMatch(String(u.dept || ''), dept)) return false;
    // 优先正常账号，历史数据缺状态时也允许展示
    return !u.status || u.status === '正常';
  });
  if (!matched.length) return '—';
  const names = matched
    .map((u) => String(u.name || '').trim() || String(u.username || '').trim())
    .filter(Boolean);
  return names.length ? [...new Set(names)].join('、') : '—';
}

type JobFormState = {
  mode: 'create' | 'edit';
  submitting: boolean;
  error: string;
  jobCode: string;
  /** 标准岗位序列（不含级别），与下拉选项 value 一致；提交时与 level 拼成 title */
  roleBase: string;
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
  /** none：交付经理/管理员；single：单选一名招聘人员；multi：招聘经理可添加多名招聘人员 */
  recruiterFieldMode?: 'none' | 'single' | 'multi';
  /** single 模式下可选的一线招聘人员列表（可跨部门） */
  recruiterStaffOptions?: User[];
}) {
  const [jdGenerating, setJdGenerating] = useState(false);
  useEffect(() => {
    if (!jobForm) setJdGenerating(false);
  }, [jobForm]);

  const handleAiGenerateJd = async () => {
    if (!jobForm) return;
    const levelNorm = normalizeJobLevel(jobForm.level);
    const roleBaseNorm = normalizeJobTitle(jobForm.roleBase);
    const fullTitle =
      levelNorm && roleBaseNorm ? composeStandardJobTitle(levelNorm, roleBaseNorm) : null;
    if (!fullTitle || !levelNorm) return;
    setJdGenerating(true);
    setJobForm((f) => (f ? { ...f, error: '' } : f));
    try {
      const r = await fetch('/api/jobs/generate-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: fullTitle,
          level: levelNorm,
          location: jobForm.location.trim(),
          salary: jobForm.salary.trim()
        })
      });
      const j = (await r.json().catch(() => ({}))) as { jdText?: string; message?: string };
      if (!r.ok) throw new Error(j.message || `生成失败 ${r.status}`);
      const jd = String(j.jdText || '').trim();
      if (!jd) throw new Error('未生成有效内容');
      setJobForm((f) => (f ? { ...f, jdText: jd } : f));
    } catch (e) {
      setJobForm((f) => (f ? { ...f, error: e instanceof Error ? e.message : 'AI 生成失败' } : f));
    } finally {
      setJdGenerating(false);
    }
  };

  const jobSingleStaffGroups = useMemo(
    () =>
      jobFormDepts
        .map((d) => ({
          dept: d,
          users: recruiterStaffOptions.filter((u) => deptNamesMatch(String(u.dept || ''), d.name))
        }))
        .filter((g) => g.users.length > 0),
    [jobFormDepts, recruiterStaffOptions]
  );

  const jobRecruiterSpecialistGroups = useMemo(
    () =>
      jobFormDepts
        .map((d) => ({
          dept: d,
          specialists: recruitingSpecialistsInDept(jobFormUsers, d.name)
        }))
        .filter((g) => g.specialists.length > 0),
    [jobFormDepts, jobFormUsers]
  );
  const allRecruiterSpecialistNames = useMemo(
    () =>
      Array.from(
        new Set(
          jobRecruiterSpecialistGroups
            .flatMap((g) => g.specialists.map((u) => String(u.name || '').trim()))
            .filter(Boolean)
        )
      ),
    [jobRecruiterSpecialistGroups]
  );
  const selectedRecruiterNames = parseRecruitersInput(jobForm?.recruiters || '');
  const allRecruitersChecked =
    allRecruiterSpecialistNames.length > 0 &&
    allRecruiterSpecialistNames.every((n) =>
      selectedRecruiterNames.some((x) => x.toLowerCase() === n.toLowerCase())
    );
  const inferredRecruiterDeptDisplay = useMemo(() => {
    const picked = parseRecruitersInput(jobForm?.recruiters || '');
    if (!picked.length) return '';
    const depts = new Set<string>();
    for (const token of picked) {
      const key = String(token || '').trim().toLowerCase();
      if (!key) continue;
      const u = jobFormUsers.find((x) => {
        const nm = String(x.name || '').trim().toLowerCase();
        const un = String(x.username || '').trim().toLowerCase();
        return nm === key || un === key;
      });
      const d = String(u?.dept || '').trim();
      if (d && d !== '-') depts.add(d);
    }
    return [...depts].join('、');
  }, [jobForm?.recruiters, jobFormUsers]);

  useEffect(() => {
    const nextDept = inferredRecruiterDeptDisplay;
    setJobForm((f) => {
      if (!f) return f;
      if (String(f.department || '').trim() === nextDept) return f;
      return { ...f, department: nextDept };
    });
  }, [inferredRecruiterDeptDisplay, setJobForm]);

  const toggleJobRecruiterPick = (name: string, checked: boolean) => {
    const n = String(name || '').trim();
    if (!n) return;
    setJobForm((f) => {
      if (!f) return f;
      const existing = parseRecruitersInput(f.recruiters);
      const next = checked
        ? existing.some((x) => x.toLowerCase() === n.toLowerCase())
          ? existing
          : [...existing, n]
        : existing.filter((x) => x.toLowerCase() !== n.toLowerCase());
      return { ...f, recruiters: next.join('、') };
    });
  };

  if (typeof document === 'undefined') return null;
  if (!jobForm) return null;
  const rfMode = recruiterFieldMode ?? 'none';
  const jdLevel = normalizeJobLevel(jobForm.level);
  const jdRoleBase = normalizeJobTitle(jobForm.roleBase);
  const canAiJd = Boolean(jdLevel && jdRoleBase && composeStandardJobTitle(jdLevel, jdRoleBase));
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
          <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div>
              <h3 id="job-form-title" className="text-lg font-bold text-slate-900">
                {jobForm.mode === 'create' ? '添加岗位' : '编辑岗位'}
              </h3>
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
            <div className="px-6 py-3 space-y-2.5 overflow-y-auto flex-1 flex flex-col min-h-0">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">所属项目</label>
                {projectIdLocked || jobForm.mode === 'edit' ? (
                  <p className="text-sm text-slate-800 font-medium">
                    {selectableProjects.find((p) => p.id === (projectIdLocked || jobForm.projectId))?.name ||
                      projectIdLocked ||
                      jobForm.projectId ||
                      '—'}
                  </p>
                ) : (
                  <select
                    value={jobForm.projectId}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, projectId: e.target.value } : f))}
                    disabled={jobForm.submitting || selectableProjects.length === 0}
                    required={selectableProjects.length > 0}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500"
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
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  岗位 <span className="text-red-500">*</span>
                </label>
                <p className="text-[11px] text-slate-400 mb-1 leading-snug">
                  展示名将保存为「所选级别 + 所选岗位」；列表与招聘系统岗位下拉对齐。
                </p>
                <select
                  value={jobForm.roleBase}
                  onChange={(e) => setJobForm((f) => (f ? { ...f, roleBase: e.target.value } : f))}
                  required
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                >
                  <option value="" disabled>
                    请选择岗位
                  </option>
                  {STANDARD_JOB_ROLE_BASES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                {jobForm.mode === 'edit' && !jobForm.roleBase ? (
                  <p className="text-[11px] text-amber-700 mt-1 leading-snug">
                    当前记录的岗位名称未能匹配标准列表，请重新选择岗位后保存（将按级别与岗位生成新的展示名称）。
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">招聘部门</label>
                  <div className="w-full min-h-[34px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                    {inferredRecruiterDeptDisplay || <span className="text-slate-400">将根据下方已选招聘人员自动显示</span>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">HC（需求人数）</label>
                  <input
                    type="number"
                    min={1}
                    value={jobForm.demand}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, demand: e.target.value } : f))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    地点 <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={jobForm.location}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, location: e.target.value } : f))}
                    required
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                    placeholder="例如：北京"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    薪资范围 <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={jobForm.salary}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, salary: e.target.value } : f))}
                    required
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                    placeholder="例如：25-35万"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    级别 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={jobForm.level}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, level: e.target.value } : f))}
                    required
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                  >
                    <option value="" disabled>
                      请选择级别
                    </option>
                    {STANDARD_JOB_LEVELS.map((lv) => (
                      <option key={lv} value={lv}>
                        {lv}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">技能关键词</label>
                  <input
                    value={jobForm.skills}
                    onChange={(e) => setJobForm((f) => (f ? { ...f, skills: e.target.value } : f))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                    placeholder="例如：React, TypeScript"
                  />
                </div>
              </div>
              {rfMode === 'single' ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-3 space-y-2">
                  <label className="block text-xs font-medium text-slate-700">招聘人员（每岗仅一人）</label>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-indigo-100 bg-white p-2">
                    {jobSingleStaffGroups.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-slate-500">
                        暂无可选招聘人员，请先在「部门管理」中维护类型为「招聘」的部门，并在该部门下创建一线招聘角色账号。
                      </p>
                    ) : (
                      <>
                        <div className="mb-2 rounded-md border border-slate-100">
                          <div className="px-2.5 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50/60 border-b border-indigo-100">
                            未指定
                          </div>
                          <div className="p-2">
                            <label className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                              <input
                                type="radio"
                                name="job-single-recruiter"
                                checked={!parseRecruitersInput(jobForm.recruiters)[0]}
                                disabled={jobForm.submitting}
                                onChange={() => setJobForm((f) => (f ? { ...f, recruiters: '' } : f))}
                                className="border-slate-300"
                              />
                              <span>未指定</span>
                            </label>
                          </div>
                        </div>
                        {jobSingleStaffGroups.map((g) => (
                          <div key={g.dept.id} className="mb-2 last:mb-0 rounded-md border border-slate-100">
                            <div className="px-2.5 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50/60 border-b border-indigo-100">
                              {g.dept.name}
                            </div>
                            <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {g.users.map((u) => {
                                const sel = parseRecruitersInput(jobForm.recruiters)[0] || '';
                                const picked = Boolean(sel && sel.toLowerCase() === u.name.trim().toLowerCase());
                                return (
                                  <label
                                    key={u.username}
                                    className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                                  >
                                    <input
                                      type="radio"
                                      name="job-single-recruiter"
                                      checked={picked}
                                      disabled={jobForm.submitting}
                                      onChange={() =>
                                        setJobForm((f) => (f ? { ...f, recruiters: u.name.trim() } : f))
                                      }
                                      className="border-slate-300"
                                    />
                                    <span>
                                      {u.name}（{u.username}）
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  {(() => {
                    const sel = parseRecruitersInput(jobForm.recruiters)[0] || '';
                    const inStaff = recruiterStaffOptions.some(
                      (u) => u.name.trim().toLowerCase() === sel.toLowerCase()
                    );
                    if (sel && !inStaff) {
                      return (
                        <p className="text-[11px] text-amber-800 px-1">
                          当前记录：{sel}（未在可选列表中，可保留或改选上方人员）
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              ) : rfMode === 'multi' ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-medium text-slate-700">
                      招聘人员（招聘专员）<span className="text-red-500 ml-1">*</span>
                    </label>
                    <button
                      type="button"
                      disabled={jobForm.submitting || allRecruiterSpecialistNames.length === 0}
                      onClick={() =>
                        setJobForm((f) =>
                          f ? { ...f, recruiters: allRecruitersChecked ? '' : allRecruiterSpecialistNames.join('、') } : f
                        )
                      }
                      className="inline-flex items-center rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      {allRecruitersChecked ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-indigo-100 bg-white p-2">
                    {jobRecruiterSpecialistGroups.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-slate-500">
                        暂无可选招聘专员。请在「用户管理」中新建用户并分配「招聘专员」角色，且账号「所属部门」须与本岗位「招聘部门」一致。
                      </p>
                    ) : (
                      jobRecruiterSpecialistGroups.map((g) => (
                        <div key={g.dept.id} className="mb-2 last:mb-0 rounded-md border border-slate-100">
                          <div className="px-2.5 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50/60 border-b border-indigo-100">
                            {g.dept.name}
                          </div>
                          <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {g.specialists.map((u) => {
                              const selected = parseRecruitersInput(jobForm.recruiters).some(
                                (x) => x.toLowerCase() === String(u.name || '').trim().toLowerCase()
                              );
                              return (
                                <label
                                  key={`${g.dept.id}-${u.username}`}
                                  className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={jobForm.submitting}
                                    onChange={(e) =>
                                      toggleJobRecruiterPick(String(u.name || '').trim(), e.target.checked)
                                    }
                                    className="rounded border-slate-300"
                                  />
                                  <span>
                                    {u.name}（{u.username}）
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                    {parseRecruitersInput(jobForm.recruiters).map((name, i) => (
                      <span
                        key={`${i}-${name}`}
                        className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-medium bg-white text-indigo-900 border border-indigo-100"
                      >
                        {name}
                        <button
                          type="button"
                          disabled={jobForm.submitting}
                          onClick={() => toggleJobRecruiterPick(name, false)}
                          className="p-0.5 rounded hover:bg-indigo-50 text-indigo-600 disabled:opacity-50"
                          aria-label={`移除 ${name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-col flex-1 min-h-[min(52vh,400px)] gap-2 pt-1 border-t border-slate-100 mt-0.5">
                <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <label className="text-xs font-medium text-slate-500">职位描述（JD）</label>
                  <button
                    type="button"
                    disabled={jobForm.submitting || jdGenerating || !canAiJd}
                    onClick={() => void handleAiGenerateJd()}
                    title={!canAiJd ? '请先填写岗位名称与级别' : undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {jdGenerating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    AI 生成
                  </button>
                </div>
                <textarea
                  value={jobForm.jdText}
                  onChange={(e) => setJobForm((f) => (f ? { ...f, jdText: e.target.value } : f))}
                  rows={14}
                  className="w-full flex-1 min-h-[min(42vh,280px)] border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y"
                  placeholder="岗位职责与任职要求；可点击「AI 生成」根据岗位名称与级别起草（已填地点、薪资会一并参考）"
                />
              </div>
              {jobForm.error ? <p className="text-sm text-red-600 shrink-0">{jobForm.error}</p> : null}
            </div>
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex flex-wrap justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={jobForm.submitting}
                onClick={onClose}
                className={btnSecondarySm}
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
                className={btnPrimaryMd}
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
  /** 岗位列表按所属项目筛选，空为全部 */
  const [jobQueryProjectFilter, setJobQueryProjectFilter] = useState('');
  /** 招聘经理：批量分配时勾选的岗位码 job_code */
  const [rmBatchSelectedJobCodes, setRmBatchSelectedJobCodes] = useState<string[]>([]);
  const [rmBatchAssignOpen, setRmBatchAssignOpen] = useState(false);
  const [rmBatchRecruiters, setRmBatchRecruiters] = useState('');
  const [rmBatchApplying, setRmBatchApplying] = useState(false);
  const [rmBatchError, setRmBatchError] = useState('');
  const rmBatchSelectAllRef = useRef<HTMLInputElement>(null);

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
              projectDept: String(p.dept || '').trim(),
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
      .then((rows: unknown) =>
        setJobFormDepts(Array.isArray(rows) ? (rows as Record<string, unknown>[]).map(mapDeptRow) : [])
      )
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
  const recruiterSelectableDepts = useMemo(() => {
    if (currentRole !== 'recruiting_manager') return jobFormDepts;
    return deliveryManagerDeptSubtree(jobFormDepts, String(authProfile?.dept || '').trim());
  }, [authProfile?.dept, currentRole, jobFormDepts]);

  useEffect(() => {
    if (currentRole !== 'recruiting_manager') return;
    if (!recruiterPickDept) return;
    const exists = recruiterSelectableDepts.some((d) => deptNamesMatch(d.name, recruiterPickDept));
    if (!exists) {
      setRecruiterPickDept('');
      setRecruiterPickUsername('');
    }
  }, [
    currentRole,
    recruiterPickDept,
    recruiterSelectableDepts,
    setRecruiterPickDept,
    setRecruiterPickUsername
  ]);

  useEffect(() => {
    if (currentRole !== 'recruiting_manager') return;
    if (!recruiterPickUsername || !recruiterPickDept) return;
    const ok = recruitingSpecialistsInDept(jobFormUsers, recruiterPickDept).some(
      (x) => x.username === recruiterPickUsername
    );
    if (!ok) setRecruiterPickUsername('');
  }, [currentRole, recruiterPickUsername, recruiterPickDept, jobFormUsers]);

  const selectableProjects = projectOptions.filter((p) => !['EMPTY', 'UNASSIGNED'].includes(p.id));

  const jobQueryProjectFilterOptions = useMemo(
    () => projectOptions.filter((p) => p.id && p.id !== 'EMPTY'),
    [projectOptions]
  );

  const filteredJobQueryRows = useMemo(() => {
    const fid = String(jobQueryProjectFilter || '').trim();
    if (!fid) return rows;
    return rows.filter((r) => String(r.job.project_id || '').trim() === fid);
  }, [rows, jobQueryProjectFilter]);

  const rmEditableFilteredRows = useMemo(() => {
    if (currentRole !== 'recruiting_manager') return [] as JobAssignmentRow[];
    return filteredJobQueryRows.filter((r) => {
      const pid = r.job.project_id;
      const p =
        pid && pid !== 'UNASSIGNED' ? projectOptions.find((x) => x.id === pid) ?? null : null;
      return recruitingManagerCanEditJob(r.job, authProfile, p);
    });
  }, [currentRole, filteredJobQueryRows, authProfile, projectOptions]);

  const rmBatchRecruiterGroups = useMemo(
    () =>
      recruiterSelectableDepts
        .map((d) => ({
          dept: d,
          specialists: recruitingSpecialistsInDept(jobFormUsers, d.name)
        }))
        .filter((g) => g.specialists.length > 0),
    [recruiterSelectableDepts, jobFormUsers]
  );

  const rmBatchAllSpecialistNames = useMemo(
    () =>
      Array.from(
        new Set(
          rmBatchRecruiterGroups
            .flatMap((g) => g.specialists.map((u) => String(u.name || '').trim()))
            .filter(Boolean)
        )
      ),
    [rmBatchRecruiterGroups]
  );

  const rmBatchAllSpecialistsChecked =
    rmBatchAllSpecialistNames.length > 0 &&
    rmBatchAllSpecialistNames.every((n) =>
      parseRecruitersInput(rmBatchRecruiters).some((x) => x.toLowerCase() === n.toLowerCase())
    );

  useEffect(() => {
    setRmBatchSelectedJobCodes([]);
  }, [jobQueryProjectFilter]);

  useEffect(() => {
    const el = rmBatchSelectAllRef.current;
    if (!el || currentRole !== 'recruiting_manager') return;
    const n = rmEditableFilteredRows.length;
    const sel = rmEditableFilteredRows.filter((r) => rmBatchSelectedJobCodes.includes(r.job.id)).length;
    el.indeterminate = sel > 0 && sel < n;
  }, [currentRole, rmEditableFilteredRows, rmBatchSelectedJobCodes]);

  useEffect(() => {
    if (!rmBatchAssignOpen) setRmBatchError('');
  }, [rmBatchAssignOpen]);

  useEffect(() => {
    const fid = String(jobQueryProjectFilter || '').trim();
    if (!fid) return;
    const ok = jobQueryProjectFilterOptions.some((p) => p.id === fid);
    if (!ok) setJobQueryProjectFilter('');
  }, [jobQueryProjectFilter, jobQueryProjectFilterOptions]);

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
      roleBase: '',
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
      roleBase: matchRoleBaseFromJobTitle(job.title, job.level) ?? '',
      projectId: pid,
      department: job.department && job.department !== '-' ? job.department : '',
      demand: String(job.demand ?? 1),
      location: job.location && job.location !== '-' ? job.location : '',
      skills: job.skills && job.skills !== '见 JD' ? job.skills : '',
      level: normalizeJobLevel(job.level) ?? '',
      salary: job.salary && job.salary !== '面议' ? job.salary : '',
      recruiters: job.recruiters?.length ? job.recruiters.join('、') : '',
      jdText: job.jdText || ''
    });
  };

  const submitJobForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobForm) return;
    const levelNorm = normalizeJobLevel(jobForm.level);
    if (!levelNorm) {
      setJobForm((f) =>
        f ? { ...f, error: jobForm.level.trim() ? jobLevelValidationMessage() : '请选择级别' } : f
      );
      return;
    }
    const roleBaseNorm = normalizeJobTitle(jobForm.roleBase);
    if (!roleBaseNorm || !composeStandardJobTitle(levelNorm, roleBaseNorm)) {
      setJobForm((f) =>
        f ? { ...f, error: jobForm.roleBase.trim() ? jobRoleBaseValidationMessage() : '请选择岗位' } : f
      );
      return;
    }
    const composedTitle = composeStandardJobTitle(levelNorm, roleBaseNorm)!;
    if (!jobForm.location.trim()) {
      setJobForm((f) => (f ? { ...f, error: '请填写工作地点' } : f));
      return;
    }
    if (!jobForm.salary.trim()) {
      setJobForm((f) => (f ? { ...f, error: '请填写薪资范围' } : f));
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
    const demand = Math.max(1, Math.min(99999, Number(jobForm.demand) || 1));
    const projectId = pidTrim;
    const isRm = currentRole === 'recruiting_manager';
    const basePayload: Record<string, unknown> = {
      title: composedTitle,
      projectId,
      department: jobForm.department.trim() || null,
      demand,
      location: jobForm.location.trim() || null,
      skills: jobForm.skills.trim() || null,
      level: levelNorm,
      salary: jobForm.salary.trim() || null,
      jdText: jobForm.jdText.trim() || null
    };
    try {
      if (jobForm.mode === 'create') {
        const jc = jobForm.jobCode.trim();
        const body: Record<string, unknown> = {
          ...basePayload,
          recruiters: isRm ? recruitersParsed : []
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
        if (isRm) patchBody.recruiters = recruitersParsed;
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

  const toggleRmBatchJobCode = (jobCode: string, checked: boolean) => {
    setRmBatchSelectedJobCodes((prev) => {
      const has = prev.includes(jobCode);
      if (checked && !has) return [...prev, jobCode];
      if (!checked && has) return prev.filter((x) => x !== jobCode);
      return prev;
    });
  };

  const toggleRmBatchSelectAllVisible = () => {
    const ids = rmEditableFilteredRows.map((r) => r.job.id);
    if (!ids.length) return;
    const allOn = ids.every((id) => rmBatchSelectedJobCodes.includes(id));
    if (allOn) {
      setRmBatchSelectedJobCodes((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setRmBatchSelectedJobCodes((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  const clearRmBatchSelection = () => setRmBatchSelectedJobCodes([]);

  const openRmBatchAssignModal = () => {
    if (!rmBatchSelectedJobCodes.length) {
      window.alert('请先在列表中勾选要分配招聘专员的岗位。');
      return;
    }
    setRmBatchError('');
    setRmBatchRecruiters('');
    setRmBatchAssignOpen(true);
  };

  const toggleRmBatchRecruiterPick = (name: string, checked: boolean) => {
    const n = String(name || '').trim();
    if (!n) return;
    const existing = parseRecruitersInput(rmBatchRecruiters);
    const next = checked
      ? existing.some((x) => x.toLowerCase() === n.toLowerCase())
        ? existing
        : [...existing, n]
      : existing.filter((x) => x.toLowerCase() !== n.toLowerCase());
    setRmBatchRecruiters(next.join('、'));
  };

  const runRmBatchAssignRecruiters = async () => {
    const recruitersParsed = parseRecruitersInput(rmBatchRecruiters);
    if (!recruitersParsed.length) {
      setRmBatchError('请至少选择一名招聘专员');
      return;
    }
    const targets = rmBatchSelectedJobCodes.filter((id) => {
      const row = rows.find((x) => x.job.id === id);
      return row && jobQueryCanEditRow(row.job);
    });
    if (!targets.length) {
      setRmBatchError('没有可写入的岗位，请勾选您有权限编辑的岗位。');
      return;
    }
    setRmBatchApplying(true);
    setRmBatchError('');
    let ok = 0;
    const fails: string[] = [];
    for (const jobId of targets) {
      const row = rows.find((x) => x.job.id === jobId);
      if (!row) continue;
      const payload = buildRecruitingManagerJobPatchPayload(row.job, recruitersParsed);
      if (!payload) {
        fails.push(`${row.job.title}（${jobId}）：无法组装保存数据`);
        continue;
      }
      try {
        const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        if (!r.ok) throw new Error(j.message || String(r.status));
        ok++;
      } catch (e) {
        fails.push(`${row.job.title}（${jobId}）：${e instanceof Error ? e.message : '失败'}`);
      }
    }
    setRmBatchApplying(false);
    loadData();
    if (fails.length === 0) {
      setRmBatchAssignOpen(false);
      setRmBatchSelectedJobCodes([]);
      setRmBatchRecruiters('');
      window.alert(`已成功为 ${ok} 个岗位统一分配招聘专员。`);
    } else {
      setRmBatchError(`成功 ${ok} 条；失败 ${fails.length} 条。`);
      window.alert(
        `成功 ${ok} 条；失败 ${fails.length} 条：\n${fails.slice(0, 10).join('\n')}${fails.length > 10 ? '\n…' : ''}`
      );
    }
  };

  const jobQueryTableColSpan = currentRole === 'recruiting_manager' ? 11 : 10;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">岗位分配</h1>
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
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h2 className="text-base font-bold text-slate-900 shrink-0">岗位列表</h2>
            <label className="flex items-center gap-2 text-sm text-slate-600 min-w-0">
              <span className="shrink-0">项目</span>
              <select
                value={jobQueryProjectFilter}
                onChange={(e) => setJobQueryProjectFilter(e.target.value)}
                className="min-w-[10rem] max-w-[20rem] border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="">全部</option>
                {jobQueryProjectFilterOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === 'UNASSIGNED' ? '未分配项目岗位' : p.name || p.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {currentRole !== 'recruiter' ? (
            <button
              type="button"
              onClick={openCreate}
              className={btnPrimaryIcon}
              aria-label="添加岗位"
            >
              <Plus className="w-5 h-5" />
            </button>
          ) : null}
        </div>

        {currentRole === 'recruiting_manager' ? (
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/90 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 text-sm">
            <div className="text-slate-700 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                已选 <strong className="text-slate-900 tabular-nums">{rmBatchSelectedJobCodes.length}</strong> 个岗位
              </span>
              <span className="text-slate-400 hidden sm:inline">·</span>
              <span className="text-slate-500">
                当前列表可勾选 <strong className="text-slate-800">{rmEditableFilteredRows.length}</strong> 条（您在「项目招聘负责人」中的项目）
              </span>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                className={btnSecondarySm}
                onClick={toggleRmBatchSelectAllVisible}
                disabled={!rmEditableFilteredRows.length}
              >
                {rmEditableFilteredRows.length > 0 &&
                rmEditableFilteredRows.every((r) => rmBatchSelectedJobCodes.includes(r.job.id))
                  ? '取消全选（当前列表）'
                  : '全选（当前列表）'}
              </button>
              <button
                type="button"
                className={btnSecondarySm}
                onClick={clearRmBatchSelection}
                disabled={!rmBatchSelectedJobCodes.length}
              >
                清空勾选
              </button>
              <button
                type="button"
                className={btnPrimarySmFlex}
                onClick={openRmBatchAssignModal}
                disabled={!rmBatchSelectedJobCodes.length}
              >
                批量分配招聘专员…
              </button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1040px]">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                {currentRole === 'recruiting_manager' ? (
                  <th className="pl-4 pr-1 py-3 w-10 text-center">
                    <input
                      ref={rmBatchSelectAllRef}
                      type="checkbox"
                      checked={
                        rmEditableFilteredRows.length > 0 &&
                        rmEditableFilteredRows.every((r) => rmBatchSelectedJobCodes.includes(r.job.id))
                      }
                      onChange={toggleRmBatchSelectAllVisible}
                      disabled={!rmEditableFilteredRows.length}
                      className="rounded border-slate-300"
                      title="全选或取消当前列表中您可编辑的岗位"
                      aria-label="全选当前列表可编辑岗位"
                    />
                  </th>
                ) : null}
                <th className="px-5 py-3 font-medium whitespace-nowrap">项目</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">交付负责人</th>
                <th
                  className="px-5 py-3 font-medium whitespace-nowrap"
                  title="与当前项目上负责本岗位招聘的成员所在部门一致；已分配招聘人员时按账号所属部门聚合；未分配招聘专员时本列为空（不使用手工填写值顶替）。"
                >
                  招聘部门
                </th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">岗位名称</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap" title="需求人数（Headcount）">
                  招聘人数（HC）
                </th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">薪资范围</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">地点</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">岗位日期</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">项目状态</th>
                <th className="px-5 py-3 font-medium text-right whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={jobQueryTableColSpan} className="px-5 py-12 text-center text-slate-500">
                    暂无岗位数据，请点击右上角「+」添加
                  </td>
                </tr>
              ) : filteredJobQueryRows.length === 0 ? (
                <tr>
                  <td colSpan={jobQueryTableColSpan} className="px-5 py-12 text-center text-slate-500">
                    当前项目筛选下无岗位，请更换「项目」条件或清空筛选
                  </td>
                </tr>
              ) : (
                filteredJobQueryRows.map(({ job, projectName, projectDept, projectStatus }) => {
                  const screenN = job.screeningCount ?? 0;
                  const hcDemand = job.demand != null && Number.isFinite(Number(job.demand)) ? String(job.demand) : '—';
                  const deliveryOwner = deliveryManagersByProjectDept(projectDept, jobFormUsers);
                  const rawWhen = (job.updatedAt || '').trim();
                  let jobDateLabel = '—';
                  if (rawWhen) {
                    const d = new Date(rawWhen);
                    jobDateLabel = Number.isNaN(d.getTime()) ? rawWhen.slice(0, 10) : d.toLocaleDateString('zh-CN');
                  }
                  const recruiterTokens = (job.recruiters || [])
                    .map((x) => String(x || '').trim())
                    .filter(Boolean);
                  const hasAssignedRecruiters = recruiterTokens.length > 0;
                  const fromRecruiters = departmentsFromJobRecruiters(job, jobFormUsers);
                  const manualDept =
                    job.department && String(job.department).trim() && job.department !== '-'
                      ? String(job.department).trim()
                      : '';
                  const recruitDept = !hasAssignedRecruiters
                    ? ''
                    : fromRecruiters || manualDept || '—';
                  const manualAlignsWithStaff =
                    !fromRecruiters ||
                    !manualDept ||
                    fromRecruiters.split('、').some((d) => deptNamesMatch(d, manualDept));
                  const recruitDeptTitle = !hasAssignedRecruiters
                    ? '尚未分配招聘专员，招聘部门留空'
                    : fromRecruiters
                      ? manualDept && !manualAlignsWithStaff
                        ? `招聘人员所属部门：${fromRecruiters}；保存字段：${manualDept}`
                        : `招聘人员所属部门：${fromRecruiters}`
                      : manualDept
                        ? `未从招聘人员名单匹配到部门，展示保存值：${manualDept}`
                        : recruitDept;
                  const ps = projectStatus || '—';
                  const statusMuted = /待归档|已结束|已关闭/.test(ps);
                  const rmRowSelectable = currentRole === 'recruiting_manager' && jobQueryCanEditRow(job);
                  return (
                    <tr key={`${job.project_id}-${job.id}`} className="hover:bg-slate-50/80 transition-colors">
                      {currentRole === 'recruiting_manager' ? (
                        <td className="pl-4 pr-1 py-4 align-top text-center w-10">
                          {rmRowSelectable ? (
                            <input
                              type="checkbox"
                              checked={rmBatchSelectedJobCodes.includes(job.id)}
                              onChange={(e) => toggleRmBatchJobCode(job.id, e.target.checked)}
                              className="rounded border-slate-300 mt-0.5"
                              aria-label={`勾选岗位 ${job.title}`}
                            />
                          ) : (
                            <input
                              type="checkbox"
                              disabled
                              checked={false}
                              className="rounded border-slate-300 opacity-35 cursor-not-allowed mt-0.5"
                              title="您不是该项目的招聘负责人，无法勾选"
                              aria-hidden
                            />
                          )}
                        </td>
                      ) : null}
                      <td className="px-5 py-4 text-slate-800 align-top max-w-[200px]">
                        <span className="line-clamp-2 font-medium" title={projectName}>
                          {projectName}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-700 align-top max-w-[160px]">
                        <span className="line-clamp-2" title={deliveryOwner}>
                          {deliveryOwner}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-700 align-top max-w-[140px]">
                        <span className="line-clamp-2" title={recruitDeptTitle}>
                          {recruitDept}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top min-w-[140px]">
                        <p className="font-semibold text-slate-900">{job.title}</p>
                        <p className="text-xs font-mono text-slate-500 mt-0.5" title="岗位码，用于筛查/邀请/报告关联">
                          {job.id}
                        </p>
                      </td>
                      <td
                        className="px-5 py-4 text-slate-800 font-medium tabular-nums align-top whitespace-nowrap"
                        title={screenN > 0 ? `需求人数；简历管理记录 ${screenN} 条` : '需求人数'}
                      >
                        {hcDemand}
                      </td>
                      <td className="px-5 py-4 text-slate-800 align-top whitespace-nowrap">{job.salary}</td>
                      <td className="px-5 py-4 text-slate-700 align-top max-w-[120px]">
                        <span className="line-clamp-2" title={job.location}>
                          {job.location}
                        </span>
                      </td>
                      <td
                        className="px-5 py-4 text-slate-600 tabular-nums align-top whitespace-nowrap text-xs"
                        title={rawWhen ? `岗位信息最近更新时间：${rawWhen}` : undefined}
                      >
                        {jobDateLabel}
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
        jobFormDepts={recruiterSelectableDepts}
        jobFormUsers={jobFormUsers}
        selectableProjects={selectableProjects}
        onSubmit={submitJobForm}
        onClose={() => setJobForm(null)}
        onNavigateResumeScreening={() => onNavigate('resume-screening')}
        recruiterFieldMode={currentRole === 'recruiting_manager' ? 'multi' : 'none'}
        recruiterStaffOptions={recruiterStaffOptions}
      />

      {rmBatchAssignOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-slate-900/50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="rm-batch-assign-title"
              onClick={() => !rmBatchApplying && setRmBatchAssignOpen(false)}
            >
              <div
                className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[min(90vh,640px)] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 id="rm-batch-assign-title" className="text-base font-bold text-slate-900">
                    批量分配招聘专员
                  </h3>
                  <button
                    type="button"
                    disabled={rmBatchApplying}
                    onClick={() => setRmBatchAssignOpen(false)}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    aria-label="关闭"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-5 py-3 text-sm text-slate-600 border-b border-slate-50 leading-relaxed">
                  将为已选的 <strong className="text-slate-900">{rmBatchSelectedJobCodes.length}</strong> 个岗位
                  <strong className="text-indigo-700"> 覆盖写入 </strong>
                  下方「招聘专员」名单；各岗位其它信息不变。可先按「项目」筛选列表再全选。
                </div>
                <div className="px-5 py-3 overflow-y-auto flex-1 space-y-3 min-h-0">
                  {rmBatchError ? (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      {rmBatchError}
                    </p>
                  ) : null}
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-medium text-slate-700">招聘专员</label>
                      <button
                        type="button"
                        disabled={rmBatchApplying || rmBatchAllSpecialistNames.length === 0}
                        onClick={() =>
                          setRmBatchRecruiters(
                            rmBatchAllSpecialistsChecked ? '' : rmBatchAllSpecialistNames.join('、')
                          )
                        }
                        className="inline-flex items-center rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                      >
                        {rmBatchAllSpecialistsChecked ? '取消全选' : '全选专员'}
                      </button>
                    </div>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-indigo-100 bg-white p-2">
                      {rmBatchRecruiterGroups.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-slate-500">
                          暂无可选招聘专员。请在「用户管理」中创建「招聘专员」角色用户，且账号所属部门在您下属部门范围内。
                        </p>
                      ) : (
                        rmBatchRecruiterGroups.map((g) => (
                          <div key={g.dept.id} className="mb-2 last:mb-0 rounded-md border border-slate-100">
                            <div className="px-2.5 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50/60 border-b border-indigo-100">
                              {g.dept.name}
                            </div>
                            <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {g.specialists.map((u) => {
                                const selected = parseRecruitersInput(rmBatchRecruiters).some(
                                  (x) => x.toLowerCase() === String(u.name || '').trim().toLowerCase()
                                );
                                return (
                                  <label
                                    key={`${g.dept.id}-${u.username}`}
                                    className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      disabled={rmBatchApplying}
                                      onChange={(e) =>
                                        toggleRmBatchRecruiterPick(String(u.name || '').trim(), e.target.checked)
                                      }
                                      className="rounded border-slate-300"
                                    />
                                    <span>
                                      {u.name}（{u.username}）
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 shrink-0">
                  <button
                    type="button"
                    className={btnSecondarySm}
                    disabled={rmBatchApplying}
                    onClick={() => setRmBatchAssignOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className={btnSaveSm}
                    disabled={rmBatchApplying}
                    onClick={() => void runRmBatchAssignRecruiters()}
                  >
                    {rmBatchApplying ? '保存中…' : '应用到已选岗位'}
                  </button>
                </div>
              </div>
            </div>,
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

function resumeEvalDimensionLabelCn(key: string): string {
  const k = String(key || '').trim()
  const map: Record<string, string> = {
    risk_fit: '风险岗位匹配',
    depth: '专业深度',
    impact: '业务影响力',
    data_skill: '数据能力',
    stability_growth: '稳定与成长',
    communication_business: '沟通与业务协同',
    tech_fit: '技术岗位匹配',
    engineering_depth: '工程深度',
    code_quality: '代码质量',
    skill: '技能',
    experience: '经验',
    education: '学历',
    stability: '稳定'
  }
  return map[k] || k
}

function pickResumeDimensionScores(
  evaluationJson: Resume['evaluationJson'] | undefined,
  fallback: { skill: number; experience: number; education: number; stability: number }
): Record<string, number> {
  const raw = evaluationJson?.dimension_scores
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const n = typeof v === 'number' ? Number(v) : Number(v?.score)
      if (!Number.isFinite(n)) continue
      out[String(k)] = Math.max(0, Math.min(100, Math.round(n)))
    }
  }
  if (Object.keys(out).length > 0) return out
  return {
    skill: fallback.skill,
    experience: fallback.experience,
    education: fallback.education,
    stability: fallback.stability
  }
}

function resumeDimensionOrderedEntries(scores: Record<string, number>): Array<[string, number]> {
  const preferred = [
    'risk_fit',
    'depth',
    'impact',
    'data_skill',
    'tech_fit',
    'engineering_depth',
    'code_quality',
    'stability_growth',
    'communication_business',
    'skill',
    'experience',
    'education',
    'stability'
  ]
  const rank = new Map<string, number>()
  preferred.forEach((k, i) => rank.set(k, i))
  return Object.entries(scores || {})
    .sort((a, b) => {
      const ra = rank.has(a[0]) ? Number(rank.get(a[0])) : 999
      const rb = rank.has(b[0]) ? Number(rank.get(b[0])) : 999
      if (ra !== rb) return ra - rb
      return a[0].localeCompare(b[0])
    })
    .slice(0, 6)
}

function resumeDimensionEvidenceText(
  evaluationJson: Resume['evaluationJson'] | undefined,
  dimKey: string
): string {
  const dim = evaluationJson?.dimension_scores?.[dimKey]
  const ev = typeof dim === 'number' ? undefined : dim?.evidence
  if (!Array.isArray(ev) || !ev.length) return '暂无评语'
  return ev
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('；')
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
    return { flowStage: 'AI面试完成', aiConclusion }
  }
  const pip = String(row.pipeline_stage ?? '').trim()
  if (pip === 'report_done') return { flowStage: 'AI面试完成', aiConclusion }
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

function uploaderDisplayFromUsers(username: string | undefined, users: User[]): string {
  const key = String(username || '').trim().toLowerCase()
  if (!key) return '—'
  const u = users.find((x) => String(x.username || '').trim().toLowerCase() === key)
  if (u) {
    const nm = String(u.name || '').trim()
    if (nm) return nm
  }
  return String(username || '').trim()
}

/** 筛查列表：接口多为带 Z 的 UTC 或已格式化的东八区墙钟字符串 */
const SCREENING_UPLOAD_TZ = 'Asia/Shanghai'

/** 后端 `DATE_FORMAT(..., ...)` 等返回的、无需再作时区转换的东八区墙钟 */
const SCREENING_NAIVE_CIVIL_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
/** 历史：东八区墙钟被 `JSON` 成 `T…Z`，再 `toLocaleString(Asia/Shanghai)` 会多 +8h；取 ISO 字面量作展示 */
const SCREENING_MISZ_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/i

function formatScreeningUploadTime(created: string | Date | null | undefined): string {
  if (created == null) return ''
  if (created instanceof Date) {
    if (Number.isNaN(created.getTime())) return ''
    return created.toLocaleString('sv-SE', { timeZone: SCREENING_UPLOAD_TZ, hour12: false })
  }
  const s = String(created).trim()
  if (!s) return ''
  // 与 MySQL 会话时区下的 DATE_FORMAT 一致，直接展示，避免 Date/ISO 来回解读差 8 或 16 小时
  if (SCREENING_NAIVE_CIVIL_RE.test(s)) return s
  const zMis = s.match(SCREENING_MISZ_RE)
  if (zMis) {
    return `${zMis[1]} ${zMis[2]}:${zMis[3]}:${zMis[4]}`
  }
  const hasExplicitZone = /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)
  if (!hasExplicitZone) {
    const naive = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/)
    if (naive) {
      const d = new Date(`${naive[1]}T${naive[2]}+08:00`)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('sv-SE', { timeZone: SCREENING_UPLOAD_TZ, hour12: false })
      }
    }
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('sv-SE', { timeZone: SCREENING_UPLOAD_TZ, hour12: false })
}

function isLikelyCandidateDisplayName(raw: unknown): boolean {
  const n = String(raw ?? '').trim()
  if (!n || n.length < 2 || n.length > 30) return false
  if (/[，。；;：:！？!?、]/.test(n)) return false
  if (/\d{4,}/.test(n)) return false
  if (/[@/\\#]/.test(n)) return false
  return /^[\u4e00-\u9fa5·•．]{2,16}$/.test(n) || /^[A-Za-z][A-Za-z\s.'-]{1,29}$/.test(n)
}

function pickCandidateDisplayName(dbName: string, evalJson: Resume['evaluationJson'] | undefined): string {
  const direct = String(dbName || '').trim()
  if (isLikelyCandidateDisplayName(direct)) return direct
  const profileName =
    evalJson && typeof evalJson === 'object' && !Array.isArray(evalJson)
      ? String(
          ((evalJson as Record<string, unknown>).candidate_profile as Record<string, unknown> | undefined)?.name ||
            (evalJson as Record<string, unknown>).candidate_name ||
            ''
        ).trim()
      : ''
  if (isLikelyCandidateDisplayName(profileName)) return profileName
  return '候选人'
}

function triBoolFromProfileField(v: unknown): boolean | null {
  if (v == null) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') {
    if (v === 1) return true
    if (v === 0) return false
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === '1' || s === '是' || s === 'true' || s === 'yes') return true
    if (s === '0' || s === '否' || s === 'false' || s === 'no') return false
  }
  return null
}

function mapScreeningRow(r: {
  id: number | string
  job_code: string
  candidate_name: string
  candidate_phone?: string | null
  candidate_id?: number | string | null
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
  evaluation_json?: unknown
  file_name?: string | null
  has_original_file?: unknown
  resume_plaintext?: string | null
  uploader_username?: string | null
  created_at: string | Date
}): Resume {
  const created = r.created_at
  const uploadTime = formatScreeningUploadTime(created)
  const overall = Math.max(0, Math.min(100, Number(r.match_score) || 0))
  const d = dimsFromScreeningDbRow(r, overall)
  const { flowStage, aiConclusion } = deriveScreeningFlowLabels(r as unknown as Record<string, unknown>)
  const parsedEval = (() => {
    const raw = r.evaluation_json
    if (raw == null) return undefined
    if (typeof raw === 'object') return raw as Resume['evaluationJson']
    try {
      return JSON.parse(String(raw)) as Resume['evaluationJson']
    } catch {
      return undefined
    }
  })()
  const evalObj = parsedEval as Record<string, unknown> | undefined
  const cp = evalObj && typeof evalObj.candidate_profile === 'object' && evalObj.candidate_profile
    ? (evalObj.candidate_profile as Record<string, unknown>)
    : null
  const candidateFilterFields: Resume['candidateFilterFields'] = cp
    ? {
        gender: String(cp.gender || '').trim(),
        education: String(cp.education || '').trim(),
        hasDegree: triBoolFromProfileField(cp.has_degree),
        isUnified: triBoolFromProfileField(cp.is_unified_enrollment),
        verifiable: triBoolFromProfileField(cp.verifiable),
        recruitmentChannel: String(cp.recruitment_channel || '').trim(),
        expectedSalary: String(cp.expected_salary || '').trim()
      }
    : undefined
  const cidRaw = r.candidate_id
  const candidateIdStr =
    cidRaw != null && String(cidRaw).trim() && Number.isFinite(Number(cidRaw)) && Number(cidRaw) > 0
      ? String(Math.floor(Number(cidRaw)))
      : undefined
  return {
    id: String(r.id),
    ...(candidateIdStr ? { candidateId: candidateIdStr } : {}),
    name: pickCandidateDisplayName(String(r.candidate_name || ''), parsedEval),
    phone: r.candidate_phone != null && String(r.candidate_phone).trim() ? String(r.candidate_phone).trim() : undefined,
    uploaderUsername:
      r.uploader_username != null && String(r.uploader_username).trim()
        ? String(r.uploader_username).trim()
        : undefined,
    job: String(r.matched_job_title || r.job_code || ''),
    jobCode: String(r.job_code || ''),
    matchScore: overall,
    skillScore: d.skill,
    experienceScore: d.experience,
    educationScore: d.education,
    stabilityScore: d.stability,
    resumeDimensionScores: pickResumeDimensionScores(parsedEval, d),
    status: aiConclusion,
    flowStage,
    uploadTime,
    reportSummary: String(r.report_summary || ''),
    evaluationJson: parsedEval,
    fileName:
      r.file_name != null && String(r.file_name).trim() ? String(r.file_name).trim().slice(0, 255) : undefined,
    hasOriginalFile: Number(r.has_original_file) === 1,
    resumePlainPreview:
      r.resume_plaintext != null && String(r.resume_plaintext).trim()
        ? String(r.resume_plaintext).trim()
        : undefined,
    candidateFilterFields
  }
}

function ListPaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (p: number) => void
  onPageSizeChange: (n: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(1, page), totalPages)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-sm text-slate-600 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-500">每页</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="border border-slate-200 rounded-md px-2 py-1 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {[10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n} 条
            </option>
          ))}
        </select>
        <span className="text-slate-500">共 {total} 条</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-slate-500 hidden sm:inline">
          {total === 0 ? '无数据' : `第 ${from}–${to} 条`}
        </span>
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
          aria-label="上一页"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="tabular-nums min-w-[4.5rem] text-center text-slate-700">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
          aria-label="下一页"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

/** 招聘渠道枚举：简历详情编辑必选其一；列表筛选「招聘渠道」与此一致 */
const RECRUITMENT_CHANNEL_OPTIONS = [
  'Boss 直聘',
  '前程无忧',
  '拉勾',
  '智联招聘',
  '猎聘',
  '线下'
] as const;

function isStandardRecruitmentChannel(v: string): boolean {
  return (RECRUITMENT_CHANNEL_OPTIONS as readonly string[]).includes(v);
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
  const [screenListPage, setScreenListPage] = useState(1);
  const [screenPageSize, setScreenPageSize] = useState(10);
  const [reportResume, setReportResume] = useState<Resume | null>(null);
  const [contactEditResume, setContactEditResume] = useState<Resume | null>(null);
  const [contactDraft, setContactDraft] = useState({ name: '', phone: '' });
  const [contactSaving, setContactSaving] = useState(false);
  const [contactEditError, setContactEditError] = useState('');
  const [profileEditResume, setProfileEditResume] = useState<Resume | null>(null);
  const [profileDraft, setProfileDraft] = useState<Record<string, string>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [fileBusyId, setFileBusyId] = useState<string | null>(null);
  const fileInputModalRef = useRef<HTMLInputElement>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  /** 简历列表多选：key 为 screening id 字符串 */
  const [screeningSelection, setScreeningSelection] = useState<Record<string, boolean>>({});
  const [screeningDeleting, setScreeningDeleting] = useState(false);
  /** 列表筛选项（与上方「项目」数据范围配合，在已加载结果上再筛） */
  const [sfName, setSfName] = useState('');
  const [sfGender, setSfGender] = useState<'all' | '男' | '女'>('all');
  const [sfEdu, setSfEdu] = useState('');
  const [sfHasDegree, setSfHasDegree] = useState<'all' | '1' | '0'>('all');
  const [sfUnified, setSfUnified] = useState<'all' | '1' | '0'>('all');
  const [sfVerifiable, setSfVerifiable] = useState<'all' | '1' | '0'>('all');
  const [sfChannel, setSfChannel] = useState('');
  const [sfSalary, setSfSalary] = useState('');
  const [sfKeyword, setSfKeyword] = useState('');
  const [screeningHrUsers, setScreeningHrUsers] = useState<User[]>([]);
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
    if (inviteJobs.length === 0) return [];
    const pidSet = new Set(
      inviteJobs.map((j) => String(j.project_id || '').trim()).filter(Boolean)
    );
    if (pidSet.size === 0) return [];
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

  /** 上传区「目标匹配岗位」下拉：随项目筛选展示该项目下岗位，首项为「全部岗位」（仅筛列表；上传须选具体岗位） */
  const jobsForUploadSelect = useMemo(() => {
    const pid = resumeProjectFilter.trim();
    if (!pid) return inviteJobs;
    if (pid === '_null') {
      return inviteJobs.filter((j) => !String(j.project_id ?? '').trim());
    }
    return inviteJobs.filter((j) => String(j.project_id ?? '').trim() === pid);
  }, [inviteJobs, resumeProjectFilter]);

  const projectNameByJobCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of inviteJobs) {
      const jc = String(j.job_code || '').trim();
      if (!jc) continue;
      const pid = String(j.project_id || '').trim();
      const p = pid ? screeningProjects.find((x) => x.id === pid) : null;
      m.set(jc, (p?.name && p.name.trim()) || pid || '');
    }
    return m;
  }, [inviteJobs, screeningProjects]);

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
          evaluation_json?: unknown
          file_name?: string | null
          has_original_file?: unknown
          resume_plaintext?: string | null
          uploader_username?: string | null
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
      setScreeningHrUsers([]);
      return;
    }
    void fetch('/api/users')
      .then((r) => r.json())
      .then((data: unknown) => setScreeningHrUsers(usersFromApiPayload(data)))
      .catch(() => setScreeningHrUsers([]));
  }, [apiBase, hasToken, sessRev]);

  useEffect(() => {
    setScreenListPage(1);
    setScreeningSelection({});
  }, [
    resumeProjectFilter,
    selectedJobCode,
    sfName,
    sfGender,
    sfEdu,
    sfHasDegree,
    sfUnified,
    sfVerifiable,
    sfChannel,
    sfSalary,
    sfKeyword
  ]);

  const resetScreeningListFilters = useCallback(() => {
    setResumeProjectFilter('');
    setSfName('');
    setSfGender('all');
    setSfEdu('');
    setSfHasDegree('all');
    setSfUnified('all');
    setSfVerifiable('all');
    setSfChannel('');
    setSfSalary('');
    setSfKeyword('');
    setSelectedJobCode('');
    setScreeningSelection({});
  }, []);

  const filteredResumes = useMemo(() => {
    const tri = (sel: 'all' | '1' | '0', v: boolean | null | undefined) => {
      if (sel === 'all') return true;
      if (v === true) return sel === '1';
      if (v === false) return sel === '0';
      return false;
    };
    const code = String(selectedJobCode || '').trim();
    let list = resumes;
    if (code) {
      const selectedJob = inviteJobs.find((j) => String(j.job_code || '').trim() === code);
      const selectedTitle = String(selectedJob?.title || '').trim();
      list = list.filter((r) => {
        const rc = String(r.jobCode || '').trim();
        if (rc && rc === code) return true;
        const rn = String(r.job || '').trim();
        if (!rn) return false;
        if (rn === code) return true;
        if (selectedTitle && (rn === selectedTitle || rn.includes(selectedTitle) || selectedTitle.includes(rn))) {
          return true;
        }
        return false;
      });
    }
    const nameQ = sfName.trim().toLowerCase();
    if (nameQ) {
      list = list.filter((r) => (r.name || '').toLowerCase().includes(nameQ));
    }
    if (sfGender !== 'all') {
      list = list.filter((r) => (r.candidateFilterFields?.gender || '') === sfGender);
    }
    const eduQ = sfEdu.trim();
    if (eduQ) {
      const eduRowMatches = (stored: string) => {
        const e = (stored || '').trim();
        if (!e) return false;
        if (eduQ === '高中') return e.includes('高中');
        if (eduQ === '大专') return e.includes('大专') || e.includes('专科') || e.includes('高职');
        if (eduQ === '本科') return e.includes('本科') || e.includes('学士');
        if (eduQ === '研究生') {
          return (
            e.includes('研究生') ||
            e.includes('硕士') ||
            e.includes('博士') ||
            /Master|Ph\.?\s*D\.?/i.test(e)
          );
        }
        return e.includes(eduQ);
      };
      list = list.filter((r) => eduRowMatches(r.candidateFilterFields?.education || ''));
    }
    list = list.filter((r) => {
      const f = r.candidateFilterFields;
      return tri(sfHasDegree, f?.hasDegree ?? null) && tri(sfUnified, f?.isUnified ?? null) && tri(sfVerifiable, f?.verifiable ?? null);
    });
    const chQ = sfChannel.trim();
    if (chQ) {
      const channelRowMatches = (stored: string) => {
        const c = (stored || '').trim();
        if (!c) return false;
        if (chQ === 'Boss 直聘') {
          const norm = c.replace(/\s+/g, '').toLowerCase();
          return norm.includes('boss') && norm.includes('直聘');
        }
        return c.includes(chQ);
      };
      list = list.filter((r) => channelRowMatches(r.candidateFilterFields?.recruitmentChannel || ''));
    }
    const salQ = sfSalary.trim();
    if (salQ) {
      list = list.filter((r) => (r.candidateFilterFields?.expectedSalary || '').includes(salQ));
    }
    const kw = sfKeyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((r) => {
        const jc = String(r.jobCode || '').trim();
        const pnm = (jc && projectNameByJobCode.get(jc)) || '';
        const blob = [
          r.name,
          r.phone || '',
          r.job,
          r.jobCode || '',
          r.reportSummary || '',
          r.status,
          r.uploaderUsername || '',
          pnm
        ]
          .join('\n')
          .toLowerCase();
        return blob.includes(kw);
      });
    }
    return list;
  }, [
    resumes,
    selectedJobCode,
    inviteJobs,
    sfName,
    sfGender,
    sfEdu,
    sfHasDegree,
    sfUnified,
    sfVerifiable,
    sfChannel,
    sfSalary,
    sfKeyword,
    projectNameByJobCode
  ]);

  const pagedResumes = useMemo(() => {
    const start = (screenListPage - 1) * screenPageSize;
    return filteredResumes.slice(start, start + screenPageSize);
  }, [filteredResumes, screenListPage, screenPageSize]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(filteredResumes.length / screenPageSize) || 1);
    setScreenListPage((p) => Math.min(Math.max(1, p), tp));
  }, [filteredResumes.length, screenPageSize]);

  const openContactEditModal = useCallback((resume: Resume) => {
    setContactEditError('');
    setContactDraft({ name: resume.name || '', phone: resume.phone || '' });
    setContactEditResume(resume);
  }, []);

  const saveScreeningContact = useCallback(async () => {
    if (!contactEditResume || !apiBase || !hasToken) return;
    setContactSaving(true);
    setContactEditError('');
    try {
      const r = await miniappApiFetch(`/api/admin/resume-screenings/${encodeURIComponent(contactEditResume.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName: contactDraft.name.trim(),
          candidatePhone: contactDraft.phone.trim()
        })
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) throw new Error(j.message || `保存失败 ${r.status}`);
      const nameNext = contactDraft.name.trim() || '候选人';
      const phoneNext = contactDraft.phone.trim();
      setReportResume((prev) =>
        prev && prev.id === contactEditResume.id
          ? { ...prev, name: nameNext, phone: phoneNext || undefined }
          : prev
      );
      setContactEditResume(null);
      loadScreenings();
    } catch (e) {
      setContactEditError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setContactSaving(false);
    }
  }, [contactEditResume, contactDraft, apiBase, hasToken, loadScreenings]);

  const openResumeProfileModal = useCallback(
    async (resume: Resume) => {
      if (!apiBase || !hasToken) return;
      setProfileEditResume(resume);
      setProfileError('');
      setProfileLoading(true);
      try {
        const r = await miniappApiFetch(`/api/admin/resume-screenings/${encodeURIComponent(resume.id)}/profile`);
        const j = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; message?: string };
        if (!r.ok) throw new Error(j.message || `加载失败 ${r.status}`);
        const d = (j.data || {}) as Record<string, unknown>;
        setProfileDraft({
          candidate_name: String(d.candidate_name || resume.name || ''),
          gender: String(d.gender || ''),
          age: d.age == null ? '' : String(d.age),
          work_experience_years: d.work_experience_years == null ? '' : String(d.work_experience_years),
          job_title: String(d.job_title || ''),
          school: String(d.school || ''),
          candidate_phone: String(d.candidate_phone || resume.phone || ''),
          email: String(d.email || ''),
          current_address: String(d.current_address || ''),
          major: String(d.major || ''),
          education: String(d.education || ''),
          current_position: String(d.current_position || ''),
          graduation_date: String(d.graduation_date || ''),
          arrival_time: String(d.arrival_time || ''),
          id_number: String(d.id_number || ''),
          is_third_party: d.is_third_party == null ? '' : String(d.is_third_party),
          expected_salary: String(d.expected_salary || ''),
          recruitment_channel: String(d.recruitment_channel || '').trim(),
          has_degree: d.has_degree == null ? '' : String(d.has_degree),
          is_unified_enrollment: d.is_unified_enrollment == null ? '' : String(d.is_unified_enrollment),
          verifiable: d.verifiable == null ? '' : String(d.verifiable)
        });
      } catch (e) {
        setProfileError(e instanceof Error ? e.message : '加载详情失败');
      } finally {
        setProfileLoading(false);
      }
    },
    [apiBase, hasToken]
  );

  const saveResumeProfile = useCallback(async () => {
    if (!profileEditResume || !apiBase || !hasToken) return;
    const ch = String(profileDraft.recruitment_channel || '').trim();
    if (!ch) {
      setProfileError('请选择招聘渠道');
      return;
    }
    if (!isStandardRecruitmentChannel(ch)) {
      setProfileError('招聘渠道须为系统预设选项之一');
      return;
    }
    setProfileSaving(true);
    setProfileError('');
    try {
      const payload = {
        candidate_name: String(profileDraft.candidate_name || '').trim(),
        gender: String(profileDraft.gender || '').trim(),
        age: String(profileDraft.age || '').trim() ? Number(profileDraft.age) : null,
        work_experience_years: String(profileDraft.work_experience_years || '').trim()
          ? Number(profileDraft.work_experience_years)
          : null,
        job_title: String(profileDraft.job_title || '').trim(),
        school: String(profileDraft.school || '').trim(),
        candidate_phone: String(profileDraft.candidate_phone || '').trim(),
        email: String(profileDraft.email || '').trim(),
        current_address: String(profileDraft.current_address || '').trim(),
        major: String(profileDraft.major || '').trim(),
        education: String(profileDraft.education || '').trim(),
        current_position: String(profileDraft.current_position || '').trim(),
        graduation_date: String(profileDraft.graduation_date || '').trim(),
        arrival_time: String(profileDraft.arrival_time || '').trim(),
        id_number: String(profileDraft.id_number || '').trim(),
        is_third_party:
          String(profileDraft.is_third_party || '').trim() === ''
            ? null
            : Number(profileDraft.is_third_party) === 1
              ? true
              : Number(profileDraft.is_third_party) === 0
                ? false
                : null,
        expected_salary: String(profileDraft.expected_salary || '').trim(),
        recruitment_channel: String(profileDraft.recruitment_channel || '').trim(),
        has_degree:
          String(profileDraft.has_degree || '').trim() === ''
            ? null
            : Number(profileDraft.has_degree) === 1
              ? true
              : Number(profileDraft.has_degree) === 0
                ? false
                : null,
        is_unified_enrollment:
          String(profileDraft.is_unified_enrollment || '').trim() === ''
            ? null
            : Number(profileDraft.is_unified_enrollment) === 1
              ? true
              : Number(profileDraft.is_unified_enrollment) === 0
                ? false
                : null,
        verifiable:
          String(profileDraft.verifiable || '').trim() === ''
            ? null
            : Number(profileDraft.verifiable) === 1
              ? true
              : Number(profileDraft.verifiable) === 0
                ? false
                : null
      };
      const r = await miniappApiFetch(`/api/admin/resume-screenings/${encodeURIComponent(profileEditResume.id)}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) throw new Error(j.message || `保存失败 ${r.status}`);
      setProfileEditResume(null);
      loadScreenings();
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setProfileSaving(false);
    }
  }, [profileEditResume, apiBase, hasToken, profileDraft, loadScreenings]);

  const openResumeOriginalFile = useCallback(
    async (resume: Resume, mode: 'preview' | 'download') => {
      if (!apiBase || !hasToken) return;
      setFileBusyId(resume.id);
      try {
        const r = await miniappApiFetch(
          `/api/admin/resume-screenings/${encodeURIComponent(resume.id)}/file?mode=${mode === 'download' ? 'download' : 'preview'}`
        );
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { message?: string };
          throw new Error(j.message || `获取文件失败 ${r.status}`);
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        if (mode === 'download') {
          const a = document.createElement('a');
          a.href = url;
          a.download = resume.fileName || 'resume';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : '获取简历文件失败');
      } finally {
        setFileBusyId(null);
      }
    },
    [apiBase, hasToken]
  );

  const deleteScreeningsByIds = useCallback(
    async (ids: string[]) => {
      /** 与库 BIGINT 一致：仅用数字串传参，避免 Number() 超过安全整数时与库 id 对不上导致删除 404 */
      const idStrs = [...new Set(ids.map((x) => String(x).trim()).filter((s) => /^\d{1,20}$/.test(s)))].slice(0, 200);
      if (!idStrs.length || !apiBase || !hasToken) return;
      const idSet = new Set(idStrs);
      setScreeningDeleting(true);
      setScreenListError('');
      try {
        const r = await miniappApiFetch('/api/admin/resume-screenings/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: idStrs })
        });
        const j = (await r.json().catch(() => ({}))) as { message?: string; deleted?: number };
        if (!r.ok) throw new Error(j.message || `删除失败 ${r.status}`);
        setScreeningSelection({});
        setReportResume((prev) => (prev && idSet.has(String(prev.id)) ? null : prev));
        setContactEditResume((prev) => (prev && idSet.has(String(prev.id)) ? null : prev));
        setProfileEditResume((prev) => (prev && idSet.has(String(prev.id)) ? null : prev));
        loadScreenings();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : '删除失败');
      } finally {
        setScreeningDeleting(false);
      }
    },
    [apiBase, hasToken, loadScreenings]
  );

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
      // 空字符串表示「全部岗位」，用于列表筛选；有可选岗位时保留该选择，不再强制选中第一项
      if (!prev) return '';
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
        message: `未在可操作岗位中找到与「${name}」对应的岗位，请联系招聘经理确认岗位分配或您的招聘人员配置。`
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
          : '上传需绑定具体岗位。请先在「目标匹配岗位」中选择某一岗位（当前为「全部岗位」时无法上传）。'
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
        setUploadModalOpen(false);
      })
      .catch((e: unknown) => {
        setUploadHint(e instanceof Error ? e.message : '上传或筛查失败');
      })
      .finally(() => setUploading(false));
  };

  return (
    <div className="space-y-4">
      {inviteBanner ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">{inviteBanner}</div>
      ) : null}
      {isRecruiter && !recruiterScopeLoading && recruiterJobCodes.length === 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          当前账号未分配可操作岗位，请联系招聘经理在「岗位分配」中为对应岗位配置招聘人员（岗位负责人）。
        </div>
      ) : null}
      {isRecruitingManager && !inviteJobsLoading && inviteJobs.length === 0 && hasToken ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          当前账号未被设为任何项目的「项目招聘负责人」，因此没有可选项目与岗位。请交付经理或管理员在「项目管理」中将您加入对应项目的「项目招聘负责人」。
        </div>
      ) : null}
      <div className="space-y-4">
        <div className="space-y-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">简历管理</h1>
            <p className="mt-0.5 text-sm text-slate-500">项目决定拉取范围，其余条件在已加载数据上进一步筛选；上传请在弹窗内选择项目与目标岗位后提交文件。</p>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
            <h2 className="text-sm font-semibold text-slate-800">条件筛选</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">项目</label>
                <select
                  value={resumeProjectFilter}
                  onChange={(e) => setResumeProjectFilter(e.target.value)}
                  disabled={
                    !apiBase ||
                    !hasToken ||
                    projectsLoading ||
                    recruiterScopeLoading ||
                    (isRecruiter && recruiterJobCodes.length === 0) ||
                    (isDeliveryManager &&
                      (!String(authProfile?.dept || '').trim() || String(authProfile?.dept || '').trim() === '-'))
                  }
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                >
                  <option value="">
                    {isDeliveryManager
                      ? '本部门全部项目'
                      : isRecruitingManager
                        ? '我的负责项目（全部）'
                        : isRecruiter && recruiterJobCodes.length === 0
                          ? '暂无分配岗位，无法按项目筛选'
                          : '全部项目'}
                  </option>
                  {projectFilterOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">岗位</label>
                <select
                  value={selectedJobCode}
                  onChange={(e) => setSelectedJobCode(e.target.value)}
                  disabled={
                    !jobsForUploadSelect.length || inviteJobsLoading || recruiterScopeLoading || !inviteJobs.length
                  }
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                >
                  {!inviteJobs.length ? (
                    <option value="">暂无可用岗位，请联系管理员在系统中维护岗位信息</option>
                  ) : jobsForUploadSelect.length === 0 ? (
                    <option value="">当前项目下暂无岗位，请更换项目或绑定岗位到项目</option>
                  ) : (
                    <>
                      <option value="">全部</option>
                      {jobsForUploadSelect.map((j) => (
                        <option key={j.job_code} value={j.job_code}>
                          {j.title} ({j.job_code})
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">候选人</label>
                <input
                  value={sfName}
                  onChange={(e) => setSfName(e.target.value)}
                  placeholder="姓名"
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">性别</label>
                <select
                  value={sfGender}
                  onChange={(e) => setSfGender(e.target.value as 'all' | '男' | '女')}
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">所有</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">学历</label>
                <select
                  value={sfEdu}
                  onChange={(e) => setSfEdu(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">所有</option>
                  <option value="高中">高中</option>
                  <option value="大专">大专</option>
                  <option value="本科">本科</option>
                  <option value="研究生">研究生</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">是否有学位</label>
                <select
                  value={sfHasDegree}
                  onChange={(e) => setSfHasDegree(e.target.value as 'all' | '1' | '0')}
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">所有</option>
                  <option value="1">是</option>
                  <option value="0">否</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">是否统招</label>
                <select
                  value={sfUnified}
                  onChange={(e) => setSfUnified(e.target.value as 'all' | '1' | '0')}
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">所有</option>
                  <option value="1">是</option>
                  <option value="0">否</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">是否可查</label>
                <select
                  value={sfVerifiable}
                  onChange={(e) => setSfVerifiable(e.target.value as 'all' | '1' | '0')}
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">所有</option>
                  <option value="1">是</option>
                  <option value="0">否</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">招聘渠道</label>
                <select
                  value={sfChannel}
                  onChange={(e) => setSfChannel(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">所有</option>
                  {RECRUITMENT_CHANNEL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">期望薪资</label>
                <input
                  value={sfSalary}
                  onChange={(e) => setSfSalary(e.target.value)}
                  placeholder="包含即可"
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-600">关键词</label>
                <input
                  value={sfKeyword}
                  onChange={(e) => setSfKeyword(e.target.value)}
                  placeholder="姓名、岗位、报告摘要等"
                  className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex flex-col justify-end">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setScreenListPage(1);
                      loadScreenings();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
                  >
                    <Search className="h-4 w-4" />
                    搜索
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetScreeningListFilters();
                      setScreenListPage(1);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-600"
                  >
                    <RotateCcw className="h-4 w-4" />
                    重置
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setUploadModalOpen(true);
                setUploadHint('');
              }}
              disabled={
                !apiBase ||
                !hasToken ||
                (isRecruiter && !recruiterScopeLoading && recruiterJobCodes.length === 0)
              }
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <UploadCloud className="h-4 w-4" />
              上传简历
            </button>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-row items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
              <h3 className="font-bold text-slate-900">简历列表</h3>
              <span className="shrink-0 text-xs text-slate-500 sm:text-sm">当前列表 {filteredResumes.length} 条</span>
            </div>
            {apiBase && hasToken && pagedResumes.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 sm:px-6">
                <span className="text-xs text-slate-600">
                  已选{' '}
                  <span className="font-semibold tabular-nums text-slate-800">
                    {Object.keys(screeningSelection).filter((k) => screeningSelection[k]).length}
                  </span>{' '}
                  条（可跨页累计）
                </span>
                <button
                  type="button"
                  disabled={
                    screeningDeleting ||
                    Object.keys(screeningSelection).every((k) => !screeningSelection[k])
                  }
                  onClick={() => {
                    const ids = Object.keys(screeningSelection).filter((k) => screeningSelection[k]);
                    if (!ids.length) return;
                    if (
                      !window.confirm(
                        `确定删除已选 ${ids.length} 条筛查记录？将同步移除详情、原件文件及邀请关联，且不可恢复。`
                      )
                    ) {
                      return;
                    }
                    void deleteScreeningsByIds(ids);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {screeningDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  删除选中
                </button>
              </div>
            ) : null}
            <div className="flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-2 sm:p-4">
              {screenListError ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">{screenListError}</div>
              ) : null}
              {!apiBase || !hasToken ? (
                <p className="text-sm text-slate-500">
                  请先完成管理端登录；登录成功后，此处将展示已上传简历的 AI 筛查记录。
                </p>
              ) : null}
              {apiBase && hasToken && filteredResumes.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {resumeProjectFilter.trim() || selectedJobCode.trim()
                    ? '当前项目/岗位筛选下暂无记录，可调整条件或点击「上传简历」补充数据。'
                    : '暂无记录。请点击「上传简历」；若长期无数据，请联系管理员确认系统是否正常。'}
                </p>
              ) : null}
              {pagedResumes.length > 0 ? (
                <div className="max-w-full overflow-x-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full table-fixed text-left text-sm text-slate-800">
                    <thead className="bg-slate-50/95 text-slate-600 border-b border-slate-200 text-xs sticky top-0 z-10">
                      <tr>
                        <th className="w-9 px-1 py-3 text-center">
                          <input
                            type="checkbox"
                            title="全选本页"
                            aria-label="全选本页"
                            checked={
                              pagedResumes.length > 0 &&
                              pagedResumes.every((r) => screeningSelection[String(r.id)])
                            }
                            ref={(el) => {
                              if (!el) return;
                              const n = pagedResumes.length;
                              const c = pagedResumes.filter((r) => screeningSelection[String(r.id)]).length;
                              el.indeterminate = n > 0 && c > 0 && c < n;
                            }}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setScreeningSelection((prev) => {
                                const next = { ...prev };
                                for (const r of pagedResumes) {
                                  const k = String(r.id);
                                  if (on) next[k] = true;
                                  else delete next[k];
                                }
                                return next;
                              });
                            }}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </th>
                        <th className="w-[12%] px-2 py-3 font-medium">候选人</th>
                        <th className="w-[10%] px-2 py-3 font-medium">手机</th>
                        <th className="w-[13%] px-2 py-3 font-medium">匹配岗位</th>
                        <th className="w-[7%] px-2 py-3 font-medium text-center">匹配分</th>
                        <th className="w-[11%] px-2 py-3 font-medium">AI 结论</th>
                        <th className="w-[9%] px-2 py-3 font-medium">流程</th>
                        <th className="w-[8%] px-2 py-3 font-medium">上传人</th>
                        <th className="w-[9%] px-2 py-3 font-medium">上传时间</th>
                        <th className="w-[13%] px-2 py-3 font-medium text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagedResumes.map((resume, idx) => {
                        const currentUser = String(authProfile?.username || '').trim().toLowerCase();
                        const uploader = String(resume.uploaderUsername || '').trim().toLowerCase();
                        const canEditContact = Boolean(currentUser && uploader && currentUser === uploader);
                        const uploaderLabel = uploaderDisplayFromUsers(resume.uploaderUsername, screeningHrUsers);
                        const rid = String(resume.id);
                        return (
                          <React.Fragment key={resume.id}>
                            <tr className={`align-top transition-colors hover:bg-indigo-50/40 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                              <td className="w-9 px-1 py-3 align-top text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(screeningSelection[rid])}
                                  onChange={(e) =>
                                    setScreeningSelection((prev) => {
                                      const next = { ...prev };
                                      if (e.target.checked) next[rid] = true;
                                      else delete next[rid];
                                      return next;
                                    })
                                  }
                                  aria-label={`选择 ${resume.name || '候选人'}`}
                                  className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                              </td>
                              <td className="max-w-0 px-2 py-3">
                                <div className="flex items-start gap-2">
                                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-700">
                                    {String(resume.name || '候').trim().slice(0, 1)}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-1">
                                      <div className="truncate font-semibold leading-tight text-slate-900">{resume.name}</div>
                                      {canEditContact ? (
                                        <button
                                          type="button"
                                          onClick={() => openContactEditModal(resume)}
                                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                                          title="修改姓名和手机号"
                                          aria-label="修改姓名和手机号"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="max-w-0 px-2 py-3 font-mono text-xs text-slate-700">
                                <div className="inline-flex min-w-0 max-w-full items-center gap-1">
                                  <span className="truncate">{resume.phone || <span className="text-slate-400">—</span>}</span>
                                  {canEditContact ? (
                                    <button
                                      type="button"
                                      onClick={() => openContactEditModal(resume)}
                                      className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                                      title="修改姓名和手机号"
                                      aria-label="修改姓名和手机号"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="max-w-0 px-2 py-3 text-xs leading-snug text-slate-700">
                                <div className="line-clamp-3 break-words">{resume.job}</div>
                              </td>
                              <td className="px-2 py-3 text-center tabular-nums">
                                <span
                                  className={`inline-flex min-w-10 justify-center rounded-md px-2 py-1 text-xs font-semibold ${
                                    resume.matchScore >= 80
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : resume.matchScore >= 60
                                        ? 'bg-amber-50 text-amber-700'
                                        : 'bg-rose-50 text-rose-700'
                                  }`}
                                >
                                  {resume.matchScore}
                                </span>
                              </td>
                              <td className="max-w-0 px-2 py-3 text-xs leading-snug text-slate-600">
                                <span className="inline-block max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">
                                  {resume.status}
                                </span>
                              </td>
                              <td className="max-w-0 px-2 py-3 text-xs">
                                {resume.flowStage ? (
                                  <span className="inline-block max-w-full truncate rounded-md bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
                                    {resume.flowStage}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="max-w-0 px-2 py-3 text-sm font-medium text-slate-900">
                                <div className="truncate" title={uploaderLabel}>
                                  {uploaderLabel}
                                </div>
                              </td>
                              <td className="max-w-0 px-2 py-3 text-xs tabular-nums text-slate-500">
                                <div className="line-clamp-2 break-all">{resume.uploadTime}</div>
                              </td>
                              <td className="max-w-0 px-2 py-3 text-right">
                                <div className="flex flex-col items-stretch gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setReportResume(resume)}
                                    className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                                  >
                                    查看报告
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void openResumeProfileModal(resume)}
                                    className="rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                                  >
                                    简历详情
                                  </button>
                                  {resume.matchScore >= 60 ? (
                                    <button
                                      type="button"
                                      onClick={() => handleInviteFromResume(resume)}
                                      disabled={!apiBase || !hasToken || Boolean(creatingInvite)}
                                      className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      发起面试
                                    </button>
                                  ) : null}
                                  {resume.hasOriginalFile ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={fileBusyId === resume.id}
                                        onClick={() => void openResumeOriginalFile(resume, 'preview')}
                                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                      >
                                        预览原件
                                      </button>
                                      <button
                                        type="button"
                                        disabled={fileBusyId === resume.id}
                                        onClick={() => void openResumeOriginalFile(resume, 'download')}
                                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                      >
                                        下载原件
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            {apiBase && hasToken && filteredResumes.length > 0 ? (
              <ListPaginationBar
                page={screenListPage}
                pageSize={screenPageSize}
                total={filteredResumes.length}
                onPageChange={setScreenListPage}
                onPageSizeChange={(n) => {
                  setScreenPageSize(n);
                  setScreenListPage(1);
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {uploadModalOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[63] flex items-center justify-center p-4 bg-slate-900/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resume-upload-modal-title"
            onClick={() => {
              if (!uploading) {
                setUploadModalOpen(false);
                setUploadHint('');
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2 }}
              className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
                <div>
                  <h3 id="resume-upload-modal-title" className="text-lg font-bold text-slate-900">
                    上传简历
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">须选择具体目标岗位，解析完成后将加入下方列表</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (uploading) return;
                    setUploadModalOpen(false);
                    setUploadHint('');
                  }}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="关闭"
                  disabled={uploading}
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-3 px-6 py-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-600">项目</label>
                    <select
                      value={resumeProjectFilter}
                      onChange={(e) => setResumeProjectFilter(e.target.value)}
                      disabled={
                        !apiBase ||
                        !hasToken ||
                        projectsLoading ||
                        recruiterScopeLoading ||
                        (isRecruiter && recruiterJobCodes.length === 0) ||
                        (isDeliveryManager &&
                          (!String(authProfile?.dept || '').trim() || String(authProfile?.dept || '').trim() === '-'))
                      }
                      className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                    >
                      <option value="">
                        {isDeliveryManager
                          ? '本部门全部项目'
                          : isRecruitingManager
                            ? '我的负责项目（全部）'
                            : isRecruiter && recruiterJobCodes.length === 0
                              ? '暂无分配岗位，无法按项目筛选'
                              : '全部项目'}
                      </option>
                      {projectFilterOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-600">目标岗位</label>
                    <select
                      value={selectedJobCode}
                      onChange={(e) => setSelectedJobCode(e.target.value)}
                      disabled={
                        !jobsForUploadSelect.length || inviteJobsLoading || recruiterScopeLoading || !inviteJobs.length
                      }
                      className="w-full rounded-lg border border-slate-200 py-2 px-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                    >
                      {!inviteJobs.length ? (
                        <option value="">暂无可用岗位，请联系管理员在系统中维护岗位信息</option>
                      ) : jobsForUploadSelect.length === 0 ? (
                        <option value="">当前项目下暂无岗位，请更换项目或绑定岗位到项目</option>
                      ) : (
                        <>
                          <option value="">请选择具体岗位</option>
                          {jobsForUploadSelect.map((j) => (
                            <option key={j.job_code} value={j.job_code}>
                              {j.title} ({j.job_code})
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                </div>
                {uploadHint ? (
                  <p
                    className={`text-xs ${
                      /失败|未创建|请先|未能|不支持|错误|无法/i.test(uploadHint) ? 'text-amber-700' : 'text-emerald-700'
                    }`}
                  >
                    {uploadHint}
                  </p>
                ) : null}
                <input
                  ref={fileInputModalRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    runUpload(f || null);
                  }}
                />
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') fileInputModalRef.current?.click();
                  }}
                  onClick={() => !uploading && fileInputModalRef.current?.click()}
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
                  className={`flex min-h-[120px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-center transition-colors group ${
                    uploading
                      ? 'cursor-wait opacity-60'
                      : 'cursor-pointer hover:border-indigo-400 hover:bg-slate-50'
                  }`}
                >
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 group-hover:scale-105 group-hover:transition-transform">
                    <UploadCloud className="h-5 w-5 text-indigo-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-700">
                    {uploading ? '正在解析与打分…' : '点击或拖拽简历到此处'}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    支持 PDF、DOCX、TXT；旧版 .doc 请另存为 DOCX 后再上传
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {contactEditResume ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[62] flex items-center justify-center p-4 bg-slate-900/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-edit-modal-title"
            onClick={() => !contactSaving && setContactEditResume(null)}
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
                <div>
                  <h3 id="contact-edit-modal-title" className="text-lg font-bold text-slate-900">修改姓名与手机号</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{contactEditResume.job || '—'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => !contactSaving && setContactEditResume(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  aria-label="关闭"
                  disabled={contactSaving}
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">姓名</label>
                  <input
                    type="text"
                    value={contactDraft.name}
                    onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="请输入候选人姓名"
                    disabled={contactSaving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">手机号</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={contactDraft.phone}
                    onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="可留空"
                    disabled={contactSaving}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">11 位大陆手机号会自动规范化，留空表示清空。</p>
                </div>
                {contactEditError ? <p className="text-xs text-red-600">{contactEditError}</p> : null}
              </div>
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-xl flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!contactSaving) {
                      setContactEditResume(null);
                      setContactEditError('');
                    }
                  }}
                  className={btnSecondarySm}
                  disabled={contactSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void saveScreeningContact()}
                  className={btnSaveSm}
                  disabled={contactSaving}
                >
                  {contactSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
                  className={btnSaveSm}
                >
                  知道了
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {profileEditResume ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[63] flex items-center justify-center p-4 bg-slate-900/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resume-profile-title"
            onClick={() => !profileSaving && setProfileEditResume(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 id="resume-profile-title" className="text-lg font-bold text-slate-900">简历详情编辑</h3>
                <button
                  type="button"
                  onClick={() => !profileSaving && setProfileEditResume(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4 overflow-y-auto space-y-3">
                {profileLoading ? (
                  <p className="text-sm text-slate-500">加载中...</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="text-xs text-slate-600">
                        姓名
                        <input
                          value={String(profileDraft.candidate_name || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, candidate_name: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        性别
                        <select
                          value={String(profileDraft.gender || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, gender: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm bg-white"
                        >
                          <option value="">请选择</option>
                          <option value="男">男</option>
                          <option value="女">女</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        年龄
                        <input
                          value={String(profileDraft.age || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, age: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        <span className="text-red-500" aria-hidden>
                          *
                        </span>
                        招聘渠道
                        <select
                          value={String(profileDraft.recruitment_channel || '').trim()}
                          onChange={(e) =>
                            setProfileDraft((d) => ({ ...d, recruitment_channel: e.target.value }))
                          }
                          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                          required
                        >
                          <option value="">请选择</option>
                          {(() => {
                            const rawCh = String(profileDraft.recruitment_channel || '').trim();
                            if (!rawCh || isStandardRecruitmentChannel(rawCh)) return null;
                            return (
                              <option value={rawCh}>{rawCh}（请改为标准项）</option>
                            );
                          })()}
                          {RECRUITMENT_CHANNEL_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        是否第三方
                        <select
                          value={String(profileDraft.is_third_party || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, is_third_party: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm bg-white"
                        >
                          <option value="">请选择</option>
                          <option value="0">否</option>
                          <option value="1">是</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        工作年限
                        <input
                          value={String(profileDraft.work_experience_years || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, work_experience_years: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        岗位
                        <input
                          value={String(profileDraft.job_title || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, job_title: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        学校
                        <input
                          value={String(profileDraft.school || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, school: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        手机号
                        <input
                          value={String(profileDraft.candidate_phone || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, candidate_phone: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        邮箱
                        <input
                          value={String(profileDraft.email || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, email: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600 sm:col-span-2">
                        现住址
                        <input
                          value={String(profileDraft.current_address || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, current_address: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        专业
                        <input
                          value={String(profileDraft.major || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, major: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        学历
                        <input
                          value={String(profileDraft.education || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, education: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        是否有学位
                        <select
                          value={String(profileDraft.has_degree || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, has_degree: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm bg-white"
                        >
                          <option value="">请选择</option>
                          <option value="0">否</option>
                          <option value="1">是</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        是否统招
                        <select
                          value={String(profileDraft.is_unified_enrollment || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, is_unified_enrollment: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm bg-white"
                        >
                          <option value="">请选择</option>
                          <option value="0">否</option>
                          <option value="1">是</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        毕业时间
                        <input
                          value={String(profileDraft.graduation_date || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, graduation_date: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                          placeholder="yyyy-MM-dd"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        到岗时间
                        <input
                          value={String(profileDraft.arrival_time || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, arrival_time: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        是否可查
                        <select
                          value={String(profileDraft.verifiable || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, verifiable: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm bg-white"
                        >
                          <option value="">请选择</option>
                          <option value="0">否</option>
                          <option value="1">是</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        当前职位
                        <input
                          value={String(profileDraft.current_position || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, current_position: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        证件号码
                        <input
                          value={String(profileDraft.id_number || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, id_number: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        期望薪资
                        <input
                          value={String(profileDraft.expected_salary || '')}
                          onChange={(e) => setProfileDraft((d) => ({ ...d, expected_salary: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
                        />
                      </label>
                    </div>
                  </>
                )}
                {profileError ? <p className="text-xs text-red-600">{profileError}</p> : null}
              </div>
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex justify-end gap-2 rounded-b-xl">
                <button type="button" className={btnSecondarySm} onClick={() => setProfileEditResume(null)} disabled={profileSaving}>
                  取消
                </button>
                <button
                  type="button"
                  className={btnSaveSm}
                  onClick={() => void saveResumeProfile()}
                  disabled={profileSaving || profileLoading}
                >
                  {profileSaving ? '保存中…' : '保存详情'}
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
                  <p className="mt-0.5 text-sm text-slate-500">
                    {reportResume.job} · {reportResume.uploadTime}
                  </p>
                  {reportResume.phone ? (
                    <p className="mt-0.5 text-xs text-slate-600">手机：{reportResume.phone}</p>
                  ) : null}
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
                {reportResume.evaluationJson?.decision ? (
                  <p className="text-xs text-slate-500 mb-2">
                    结构化结论：
                    <span className="ml-1 font-medium text-slate-700">{reportResume.evaluationJson.decision}</span>
                  </p>
                ) : null}
                <p className="text-xs text-slate-500 mb-3">
                  维度：
                  {Object.entries(reportResume.resumeDimensionScores || {}).length
                    ? resumeDimensionOrderedEntries(reportResume.resumeDimensionScores || {})
                        .map(([k, v]) => `${resumeEvalDimensionLabelCn(k)} ${v}`)
                        .join(' / ')
                    : `技能 ${reportResume.skillScore ?? '—'} / 经验 ${reportResume.experienceScore ?? '—'} / 学历 ${
                        reportResume.educationScore ?? '—'
                      } / 稳定 ${reportResume.stabilityScore ?? '—'}`}
                </p>
                {Object.entries(reportResume.resumeDimensionScores || {}).length ? (
                  <div className="mb-3 grid grid-cols-1 gap-2">
                    {resumeDimensionOrderedEntries(reportResume.resumeDimensionScores || {}).map(([k, v]) => (
                      <div key={`eval-dim-${k}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-semibold text-slate-700">
                          {resumeEvalDimensionLabelCn(k)} · <span className="tabular-nums">{Number(v) || 0}</span>
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          {resumeDimensionEvidenceText(reportResume.evaluationJson, k)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {reportResume.reportSummary?.trim() || '暂无报告正文。'}
                </div>
                {Array.isArray(reportResume.evaluationJson?.strengths) && reportResume.evaluationJson.strengths.length ? (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-slate-800 mb-1.5">结构化优势</h4>
                    <ul className="text-sm text-slate-700 space-y-1">
                      {reportResume.evaluationJson.strengths.slice(0, 5).map((x, idx) => (
                        <li key={idx}>- {x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {Array.isArray(reportResume.evaluationJson?.risks) && reportResume.evaluationJson.risks.length ? (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-slate-800 mb-1.5">结构化风险与核验问题</h4>
                    <ul className="text-sm text-slate-700 space-y-1.5">
                      {reportResume.evaluationJson.risks.slice(0, 5).map((r, idx) => (
                        <li key={idx}>
                          -{' '}
                          {typeof r === 'string'
                            ? String(r || '未描述风险')
                            : String(r?.risk || r?.interview_question || '未描述风险')}
                          {(typeof r === 'object' && r?.interview_question) ? (
                            <span className="text-slate-500">（面试核验：{String(r.interview_question)}）</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
    projectName: string
    /** 筛选用：有面试分用面试分，否则用简历分 */
    score: number
    resumeMatchScore: number
    /** 面试综合分，无报告时为 null */
    interviewScore: number | null
    hasInterviewReport: boolean
    resumeDimensionScores: Record<string, number>
    /** 流程阶段：简历筛查完成 / 已发邀请 / AI面试完成 … */
    status: string
    /** 岗位配置的招聘人员（姓名列表） */
    recruitersLabel: string
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
  const [appListPage, setAppListPage] = useState(1)
  const [appPageSize, setAppPageSize] = useState(10)
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
          const interviewScore = ivParsed
          const scoreForFilter =
            hasInterviewReport && interviewScore !== null ? interviewScore : resumeMatch
          const parsedEval = (() => {
            const raw = row.evaluation_json
            if (raw == null) return undefined
            if (typeof raw === 'object') return raw as Resume['evaluationJson']
            try {
              return JSON.parse(String(raw)) as Resume['evaluationJson']
            } catch {
              return undefined
            }
          })()
          return {
            id: String(row.id ?? ''),
            candidateName: String(row.candidate_name ?? '候选人'),
            jobCode: String(row.job_code ?? ''),
            jobTitle: String(row.matched_job_title ?? row.job_code ?? ''),
            score: scoreForFilter,
            resumeMatchScore: resumeMatch,
            interviewScore,
            hasInterviewReport,
            resumeDimensionScores: pickResumeDimensionScores(parsedEval, d),
            status: flowStage,
            recruitersLabel: '—'
          }
        })
        const projectsPayload = projectsRes.ok
          ? ((await projectsRes.json().catch(() => [])) as unknown)
          : []
        const allProjects: Project[] = Array.isArray(projectsPayload) ? projectsPayload : []
        const jobCodeToProjectName = new Map<string, string>()
        const jobCodeToRecruiters = new Map<string, string>()
        for (const p of allProjects) {
          if (!p.id || p.id === 'EMPTY' || p.id === 'UNASSIGNED') continue
          const pname = String(p.name || p.id || '').trim() || String(p.id)
          for (const job of p.jobs || []) {
            const jc = String(job.id || '').trim()
            if (!jc) continue
            if (!jobCodeToProjectName.has(jc)) jobCodeToProjectName.set(jc, pname)
            if (!jobCodeToRecruiters.has(jc)) {
              const rs = (job.recruiters || []).map((x) => String(x || '').trim()).filter(Boolean)
              jobCodeToRecruiters.set(jc, rs.length ? rs.join('、') : '—')
            }
          }
        }
        const withProject = mapped.map((r) => {
          const jc = String(r.jobCode || '').trim()
          return {
            ...r,
            projectName: jobCodeToProjectName.get(jc) || '—',
            recruitersLabel: jobCodeToRecruiters.get(jc) || '—'
          }
        })
        if (isAdminRole) {
          setRows(withProject)
          return
        }
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
            withProject.filter((x) => {
              const jc = String(x.jobCode || '').trim()
              return Boolean(jc && leadJobCodes.has(jc))
            })
          )
          return
        }
        if (currentRole === 'recruiter') {
          const myJobCodes = recruiterAssignedJobCodesFromProjects(allProjects, authProfile)
          setRows(
            withProject.filter((x) => {
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
          : withProject.filter((x) => {
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
        row.jobCode.toLowerCase().includes(kw) ||
        row.projectName.toLowerCase().includes(kw) ||
        row.recruitersLabel.toLowerCase().includes(kw)
      if (!hit) return false
    }
    if (statusFilter && row.status !== statusFilter) return false
    if (scoreFilter === 'high' && row.score < 80) return false
    if (scoreFilter === 'mid' && (row.score < 60 || row.score >= 80)) return false
    if (scoreFilter === 'low' && row.score >= 60) return false
    return true
  })

  useEffect(() => {
    setAppListPage(1)
  }, [keyword, statusFilter, scoreFilter])

  const pagedFilteredRows = useMemo(() => {
    const start = (appListPage - 1) * appPageSize
    return filteredRows.slice(start, start + appPageSize)
  }, [filteredRows, appListPage, appPageSize])

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(filteredRows.length / appPageSize) || 1)
    setAppListPage((p) => Math.min(Math.max(1, p), tp))
  }, [filteredRows.length, appPageSize])

  const statusOptions = Array.from(new Set(rows.map((x) => x.status).filter(Boolean)))
  const dimBadgeClass = (n: number) =>
    n >= 80
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : n >= 60
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-rose-50 text-rose-700 border-rose-200'

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

  const downloadInterviewReport = useCallback(() => {
    if (!reportModal) return;
    const esc = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const dims = Object.entries(reportModal.dimensionScores || {})
      .map(([k, v]) => `<li>${esc(interviewReportDimensionLabelCn(k))}：${Number(v) || 0}</li>`)
      .join('');
    const suggestions =
      (reportModal.suggestions || []).length > 0
        ? reportModal.suggestions.map((x) => `<li>${esc(x)}</li>`).join('')
        : '<li>无</li>';
    const risks =
      (reportModal.riskPoints || []).length > 0
        ? reportModal.riskPoints.map((x) => `<li>${esc(x)}</li>`).join('')
        : '<li>无</li>';
    const qa =
      (reportModal.qa || []).length > 0
        ? reportModal.qa
            .map(
              (item, idx) =>
                `<div style="margin: 0 0 12px 0; padding: 8px; border: 1px solid #e5e7eb; border-radius: 6px;">
                  <p style="margin: 0 0 6px 0;"><strong>Q${idx + 1}：</strong>${esc(String(item.question || '—'))}</p>
                  <p style="margin: 0;"><strong>A：</strong>${esc(String(item.answer || '（无作答）')).replace(/\n/g, '<br/>')}</p>
                </div>`
            )
            .join('')
        : '<p>暂无答题明细</p>';
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>面试报告</title>
</head>
<body style="font-family: 'Microsoft YaHei', Arial, sans-serif; color: #111827; line-height: 1.6;">
  <h2 style="margin: 0 0 12px 0;">AI-Recruit 面试报告</h2>
  <p style="margin: 0 0 4px 0;"><strong>候选人：</strong>${esc(reportModal.candidateName)}</p>
  <p style="margin: 0 0 4px 0;"><strong>岗位：</strong>${esc(reportModal.jobCode)}</p>
  <p style="margin: 0 0 12px 0;"><strong>更新时间：</strong>${esc(reportModal.updatedAt || '—')}</p>

  <h3 style="margin: 14px 0 8px 0;">综合结果</h3>
  <p style="margin: 0 0 4px 0;"><strong>综合评分：</strong>${reportModal.score}</p>
  <p style="margin: 0 0 8px 0;"><strong>结果：</strong>${reportModal.passed ? '通过' : '待提升'}</p>
  <p style="margin: 0; white-space: pre-wrap;">${esc(reportModal.overallFeedback || '暂无综合结论')}</p>

  <h3 style="margin: 14px 0 8px 0;">维度评分</h3>
  <ul style="margin: 0 0 8px 18px; padding: 0;">${dims || '<li>无</li>'}</ul>

  <h3 style="margin: 14px 0 8px 0;">改进建议</h3>
  <ul style="margin: 0 0 8px 18px; padding: 0;">${suggestions}</ul>

  <h3 style="margin: 14px 0 8px 0;">风险点</h3>
  <ul style="margin: 0 0 8px 18px; padding: 0;">${risks}</ul>

  <h3 style="margin: 14px 0 8px 0;">答题明细</h3>
  ${qa}
</body>
</html>`;
    const safeName = `${reportModal.candidateName || '候选人'}-${reportModal.jobCode || '岗位'}-面试报告`
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 120);
    const blob = new Blob(['\uFEFF', html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [reportModal]);

  return (
    <div className="space-y-6">
      {!isAdminRole && !deptScoped ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          无法按部门筛选初面数据：账号未设置「所属部门」。请管理员在「用户管理」中填写部门（须与项目上的部门名称一致），保存后重新登录。
        </div>
      ) : null}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="space-y-4 border-b border-slate-100 bg-slate-50 px-4 py-4 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">初面管理</h3>
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
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索候选人/项目/岗位/编码"
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
              title="按列表分筛选：已有面试报告时用面试分，否则用简历分"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">列表分（全部）</option>
              <option value="high">列表分 80+</option>
              <option value="mid">列表分 60–79</option>
              <option value="low">列表分 &lt;60</option>
            </select>
          </div>
        </div>
        {err ? (
          <div className="border-b border-slate-100 px-4 py-3 text-sm text-red-600 sm:px-6">{err}</div>
        ) : null}
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[72rem] text-left text-sm">
            <thead className="border-b border-slate-200 bg-white text-slate-600">
              <tr>
                <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">候选人</th>
                <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">项目</th>
                <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">岗位名称</th>
                <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">简历分</th>
                <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">简历维度</th>
                <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">面试分</th>
                <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">阶段</th>
                <th className="min-w-[7rem] px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">招聘人员</th>
                <th className="px-3 py-3 text-right text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">面试报告</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-3 py-8 text-slate-500 sm:px-6" colSpan={9}>
                    加载中...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-slate-500 sm:px-6" colSpan={9}>
                    暂无数据，请先在「简历管理」中上传简历
                  </td>
                </tr>
              ) : (
                pagedFilteredRows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-3 font-bold text-slate-900 sm:px-6 sm:py-4">
                      {row.candidateName}
                    </td>
                    <td className="max-w-[10rem] px-3 py-3 text-slate-600 sm:max-w-[12.5rem] sm:px-6 sm:py-4" title={row.projectName}>
                      <span className="line-clamp-2">{row.projectName}</span>
                    </td>
                    <td className="max-w-[12rem] px-3 py-3 text-slate-600 sm:max-w-none sm:px-6 sm:py-4">
                      <span className="font-medium text-slate-800">{row.jobTitle}</span>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400" title="岗位编码">
                        {row.jobCode}
                      </p>
                    </td>
                    <td className="whitespace-nowrap tabular-nums px-3 py-3 sm:px-6 sm:py-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-900">
                        {row.resumeMatchScore}
                      </span>
                    </td>
                    <td className="min-w-[12rem] px-3 py-3 text-xs text-slate-600 sm:min-w-[14rem] sm:px-6 sm:py-4">
                      <div className="grid grid-cols-2 gap-1.5">
                        {resumeDimensionOrderedEntries(row.resumeDimensionScores || {})
                          .map(([k, v]) => (
                            <span
                              key={`${row.id}-${k}`}
                              className={`inline-flex items-center justify-between rounded-md border px-2 py-1 ${dimBadgeClass(
                                Number(v) || 0
                              )}`}
                            >
                              <span>{resumeEvalDimensionLabelCn(k)}</span>
                              <span className="font-semibold">{Number(v) || 0}</span>
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap tabular-nums px-3 py-3 sm:px-6 sm:py-4">
                      {row.interviewScore !== null ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 font-semibold text-violet-900">
                          {row.interviewScore}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 sm:px-6 sm:py-4">
                      <span
                        className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                          row.status === 'AI面试完成'
                            ? 'bg-violet-100 text-violet-800'
                            : row.status === '已发面试邀请'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td
                      className="max-w-[10rem] truncate px-3 py-3 text-slate-600 sm:max-w-[12rem] sm:px-6 sm:py-4"
                      title={row.recruitersLabel}
                    >
                      {row.recruitersLabel}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right sm:px-6 sm:py-4">
                      <button
                        type="button"
                        disabled={Boolean(reportLoadingId) || !row.hasInterviewReport}
                        onClick={() => {
                          if (!row.hasInterviewReport) return;
                          void handleOpenInterviewReport(row);
                        }}
                        title={row.hasInterviewReport ? '查看面试报告详情' : '候选人尚未产生可关联的面试报告'}
                        className={`text-xs font-medium sm:text-sm ${
                          row.hasInterviewReport
                            ? 'text-indigo-600 hover:text-indigo-800 disabled:opacity-50'
                            : 'cursor-not-allowed text-slate-400'
                        }`}
                      >
                        {reportLoadingId === row.id && row.hasInterviewReport
                          ? '加载中…'
                          : row.hasInterviewReport
                            ? '查看'
                            : '暂无'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && filteredRows.length > 0 ? (
          <ListPaginationBar
            page={appListPage}
            pageSize={appPageSize}
            total={filteredRows.length}
            onPageChange={setAppListPage}
            onPageSizeChange={(n) => {
              setAppPageSize(n)
              setAppListPage(1)
            }}
          />
        ) : null}
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
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 rounded-b-xl flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => downloadInterviewReport()}
                  className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                >
                  下载报告
                </button>
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
  const rawType = r.dept_type ?? r.deptType ?? (r as { DEPT_TYPE?: unknown }).DEPT_TYPE;
  return {
    id: String(r.id ?? ''),
    parentId: r.parent_id != null && String(r.parent_id).trim() ? String(r.parent_id) : null,
    name: String(r.name ?? ''),
    deptType: String(rawType ?? '').trim(),
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

const RECRUITMENT_DEPT_BUSINESS_TYPE = '招聘';

function deptIsRecruitmentBusinessType(d: Dept): boolean {
  return String(d.deptType ?? '').trim() === RECRUITMENT_DEPT_BUSINESS_TYPE;
}

/** 沿 parentId 向上直到顶级，得到该节点所在子树的根 */
function getRootAncestorDept(depts: Dept[], startId: string): Dept | null {
  const byId = new Map(depts.map((d) => [d.id, d]));
  let cur = byId.get(startId);
  if (!cur) return null;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cur.id)) return cur;
    seen.add(cur.id);
    const pid = String(cur.parentId || '').trim();
    if (!pid) return cur;
    const next = byId.get(pid);
    if (!next) return cur;
    cur = next;
  }
}

/**
 * 项目招聘负责人 — 选部门：登录人所属部门在组织树上的顶级祖先之下的整棵子树内，
 * 且部门类型为「招聘」的部门（按树顺序）。管理员若账号未匹配到部门节点，则展示全部「招聘」类型部门。
 */
function recruitmentDeptOptionsForProjectLeads(depts: Dept[], userDeptName: string, role: Role): Dept[] {
  const recruitmentOrdered = flattenDeptTree(depts)
    .map(({ dept }) => dept)
    .filter((d) => deptIsRecruitmentBusinessType(d));

  const ud = String(userDeptName || '').trim();
  if (!ud || ud === '-') {
    return role === 'admin' ? recruitmentOrdered : [];
  }

  const matched = depts.filter((d) => deptNamesMatch(ud, d.name));
  if (!matched.length) {
    return role === 'admin' ? recruitmentOrdered : [];
  }

  const rootIds: string[] = [];
  for (const m of matched) {
    const root = getRootAncestorDept(depts, m.id);
    if (root && !rootIds.includes(root.id)) rootIds.push(root.id);
  }
  if (!rootIds.length) {
    return role === 'admin' ? recruitmentOrdered : [];
  }

  const allowed = collectDescendantDeptIds(depts, rootIds);
  return recruitmentOrdered.filter((d) => allowed.has(d.id));
}

function normalizeDeptFormType(s: string | undefined): '交付' | '招聘' | '其他' {
  const t = String(s || '').trim();
  if (t === '交付' || t === '招聘' || t === '其他') return t;
  return '其他';
}

function SystemDeptView() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [deptListPage, setDeptListPage] = useState(1);
  const [deptPageSize, setDeptPageSize] = useState(10);
  const [collapsedDeptIds, setCollapsedDeptIds] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<
    null | { mode: 'create' | 'edit' | 'child'; parent?: Dept; record?: Dept }
  >(null);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDeptType, setFormDeptType] = useState<'交付' | '招聘' | '其他'>('交付');
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

  const childCountByDeptId = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of depts) {
      const pid = String(d.parentId || '').trim();
      if (!pid) continue;
      m.set(pid, (m.get(pid) || 0) + 1);
    }
    return m;
  }, [depts]);

  const displayRows = useMemo(() => {
    const flat = flattenDeptTree(depts);
    const qq = q.trim().toLowerCase();
    const filtered = !qq
      ? flat
      : flat.filter(
          ({ dept }) =>
            String(dept.name || '').toLowerCase().includes(qq) ||
            String(dept.manager || '').toLowerCase().includes(qq)
        );
    if (qq) return filtered;
    const out: { dept: Dept; depth: number }[] = [];
    let hiddenDepth: number | null = null;
    for (const row of filtered) {
      if (hiddenDepth !== null) {
        if (row.depth > hiddenDepth) continue;
        hiddenDepth = null;
      }
      out.push(row);
      if (collapsedDeptIds.has(row.dept.id)) hiddenDepth = row.depth;
    }
    return out;
  }, [depts, q, collapsedDeptIds]);

  const pagedRows = useMemo(() => {
    const start = (deptListPage - 1) * deptPageSize;
    return displayRows.slice(start, start + deptPageSize);
  }, [displayRows, deptListPage, deptPageSize]);

  useEffect(() => {
    setDeptListPage(1);
  }, [q]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(displayRows.length / deptPageSize) || 1);
    setDeptListPage((p) => Math.min(Math.max(1, p), tp));
  }, [displayRows.length, deptPageSize]);

  const toggleCollapseDept = (deptId: string) => {
    setCollapsedDeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const openCreate = () => {
    setDialog({ mode: 'create' });
    setFormName('');
    setFormDeptType('交付');
    setFormLevel('0');
    setFormManager('');
    setFormCount('0');
  };

  const openChild = (parent: Dept) => {
    setDialog({ mode: 'child', parent });
    setFormName('');
    setFormDeptType('交付');
    setFormManager('');
    setFormCount('0');
  };

  const openEdit = (d: Dept) => {
    setDialog({ mode: 'edit', record: d });
    setFormName(d.name);
    setFormDeptType(normalizeDeptFormType(d.deptType));
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
      const deptRows = await adminFetchJson<Array<Record<string, unknown>>>('/api/depts');
      const rows = Array.isArray(deptRows) ? deptRows : [];
      setDepts(rows.map(mapDeptRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载部门失败');
      setDepts([]);
    }
    try {
      const userPayload = await adminFetchJson<unknown>('/api/users');
      setHrUsers(usersFromApiPayload(userPayload));
    } catch {
      // 与部门列表无关：用户接口失败时保留已有部门数据，避免保存后整表被清空
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
            deptType: formDeptType,
            dept_type: formDeptType,
            level: Math.max(0, Math.min(99, level)),
            manager,
            count
          })
        });
      } else {
        const body: Record<string, unknown> = {
          name,
          deptType: formDeptType,
          dept_type: formDeptType,
          manager,
          count
        };
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
          className={btnPrimarySmFlex}
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
          <>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-6 py-4 font-medium">部门名称</th>
                <th className="px-6 py-4 font-medium">部门类型</th>
                <th className="px-6 py-4 font-medium">负责人</th>
                <th className="px-6 py-4 font-medium">成员数量</th>
                <th className="px-6 py-4 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedRows.map(({ dept, depth }) => (
                <tr key={dept.id} className="hover:bg-slate-50 transition-colors">
                  <td
                    className="px-6 py-4 font-medium text-slate-900"
                    style={{ paddingLeft: `${depth * 1.5 + 1.5}rem` }}
                  >
                    <div className="flex items-center gap-2">
                      {childCountByDeptId.get(dept.id) ? (
                        <button
                          type="button"
                          onClick={() => toggleCollapseDept(dept.id)}
                          className="inline-flex items-center justify-center rounded border border-slate-200 bg-white p-0.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                          title={collapsedDeptIds.has(dept.id) ? '展开子部门' : '折叠子部门'}
                        >
                          {collapsedDeptIds.has(dept.id) ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4" />
                      )}
                      <Network className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span>{dept.name}</span>
                      <span className="text-xs font-normal text-slate-400">L{dept.level}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-600 text-xs">
                    {dept.deptType ? (
                      <span
                        className={
                          dept.deptType === '招聘'
                            ? 'rounded-md bg-emerald-50 text-emerald-800 px-2 py-0.5 font-medium'
                            : dept.deptType === '交付'
                              ? 'rounded-md bg-sky-50 text-sky-800 px-2 py-0.5 font-medium'
                              : 'rounded-md bg-slate-100 text-slate-700 px-2 py-0.5 font-medium'
                        }
                      >
                        {dept.deptType}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
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
          <ListPaginationBar
            page={deptListPage}
            pageSize={deptPageSize}
            total={displayRows.length}
            onPageChange={setDeptListPage}
            onPageSizeChange={(n) => {
              setDeptPageSize(n);
              setDeptListPage(1);
            }}
          />
          </>
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
              className={btnSecondarySm}
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitDept()}
              className={btnSaveSm}
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
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">部门名称</label>
          <input className={systemFieldClass} value={formName} onChange={(e) => setFormName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">部门类型</label>
          <select
            className={systemFieldClass}
            value={formDeptType}
            onChange={(e) => setFormDeptType(e.target.value as '交付' | '招聘' | '其他')}
            disabled={saving}
          >
            <option value="交付">交付</option>
            <option value="招聘">招聘</option>
            <option value="其他">其他</option>
          </select>
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
        ) : null}
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
  const [deptTree, setDeptTree] = useState<Dept[]>([]);
  const [deptNames, setDeptNames] = useState<string[]>([]);
  const [roleOptions, setRoleOptions] = useState<SysRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [userListPage, setUserListPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [userDialog, setUserDialog] = useState<null | { mode: 'create' | 'edit'; user?: User }>(null);
  const [saving, setSaving] = useState(false);
  const [ufName, setUfName] = useState('');
  const [ufUsername, setUfUsername] = useState('');
  const [ufDept, setUfDept] = useState('');
  const [ufRole, setUfRole] = useState('');
  const [ufStatus, setUfStatus] = useState<'正常' | '停用'>('正常');
  const [ufPassword, setUfPassword] = useState('');
  const [ufPasswordConfirm, setUfPasswordConfirm] = useState('');

  const myDept = String(authProfile?.dept || '').trim();
  const myDeptOk = Boolean(myDept && myDept !== '-');
  /** 平台管理员始终可查看与维护全部用户；其他角色仅本部门 */
  const listAllUsers = currentRole === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userRows, deptRowsRaw, roleRows] = await Promise.all([
        adminFetchJson<User[]>('/api/users'),
        adminFetchJson<Array<Record<string, unknown>>>('/api/depts'),
        adminFetchJson<Array<Record<string, unknown>>>('/api/roles')
      ]);
      const deptRows = Array.isArray(deptRowsRaw) ? deptRowsRaw.map(mapDeptRow) : [];
      setDeptTree(deptRows);
      const ud = String(authProfile?.dept || '').trim();
      const udOk = Boolean(ud && ud !== '-');
      const showAll = currentRole === 'admin';
      const subtreeForAccount = udOk && !showAll ? deliveryManagerDeptSubtree(deptRows, ud) : [];
      const scopedUsers = showAll
        ? userRows
        : udOk
          ? userRows.filter((u) => userDeptInSubtree(String(u.dept || ''), subtreeForAccount))
          : [];
      setUsers(scopedUsers);
      const names = [...new Set(deptRows.map((d) => String(d.name || '')).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'zh-CN')
      );
      const formDeptNames = showAll
        ? names
        : udOk
          ? [
              ...new Set(
                subtreeForAccount.map((d) => String(d.name || '').trim()).filter(Boolean)
              )
            ].sort((a, b) => a.localeCompare(b, 'zh-CN'))
          : names;
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
      setDeptTree([]);
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

  const adminDeptSubtree = useMemo(() => {
    if (!listAllUsers || !deptFilter.trim()) return null;
    return deliveryManagerDeptSubtree(deptTree, deptFilter);
  }, [listAllUsers, deptFilter, deptTree]);

  /** 非管理员可维护的用户部门范围：本人部门及其组织子树 */
  const editableSubtreeForMe = useMemo(() => {
    if (listAllUsers || !myDeptOk) return null;
    return deliveryManagerDeptSubtree(deptTree, myDept);
  }, [listAllUsers, myDeptOk, deptTree, myDept]);

  useEffect(() => {
    setUserListPage(1);
  }, [q, deptFilter]);

  const userDialogRoleSelectOptions = useMemo(() => {
    const base = roleOptions.filter((r) => roleNameAllowedInUserDialogForCreator(currentRole, r.name));
    const list = base.length > 0 ? base : roleOptions;
    if (userDialog?.mode === 'edit' && userDialog.user) {
      const cur = String(userDialog.user.role || '').trim();
      if (cur && !list.some((r) => r.name === cur)) {
        return [...list, { id: '__current_role__', name: cur, desc: '', users: 0 }];
      }
    }
    return list;
  }, [roleOptions, currentRole, userDialog]);

  const openUserCreate = () => {
    setUserDialog({ mode: 'create' });
    setUfName('');
    setUfUsername('');
    setUfDept(listAllUsers ? '' : myDeptOk && deptNames.includes(myDept) ? myDept : deptNames[0] || '');
    const allowed = roleOptions.filter((r) => roleNameAllowedInUserDialogForCreator(currentRole, r.name));
    const priority: string[] =
      currentRole === 'delivery_manager'
        ? ['交付经理']
        : currentRole === 'recruiting_manager'
          ? ['招聘经理', '招聘人员', '招聘专员']
          : [];
    let def = '';
    for (const p of priority) {
      if (allowed.some((r) => r.name === p)) {
        def = p;
        break;
      }
    }
    if (!def) def = allowed[0]?.name || roleOptions[0]?.name || '招聘人员';
    setUfRole(def);
    setUfStatus('正常');
    setUfPassword('');
    setUfPasswordConfirm('');
  };

  const openUserEdit = (u: User) => {
    setUserDialog({ mode: 'edit', user: u });
    setUfName(u.name);
    setUfUsername(u.username);
    setUfDept(u.dept || '');
    setUfRole(u.role || '');
    setUfStatus(u.status === '停用' ? '停用' : '正常');
    setUfPassword('');
    setUfPasswordConfirm('');
  };

  const closeUserDialog = () => {
    if (saving) return;
    setUserDialog(null);
    setUfPasswordConfirm('');
  };

  const submitUser = async () => {
    if (!userDialog) return;
    const name = ufName.trim();
    const username = ufUsername.trim();
    const dept = ufDept.trim() || '-';
    const role = ufRole.trim() || '招聘人员';
    if (!name.trim()) {
      setError('请填写姓名');
      return;
    }
    if (!username) {
      if (userDialog.mode === 'create' && !roleAllowsNonMobileLoginUsername(role)) {
        setError('请填写手机号（即登录账号）');
      } else {
        setError(roleAllowsNonMobileLoginUsername(role) ? '请填写登录账号' : '请填写手机号（即登录账号）');
      }
      return;
    }
    if (!listAllUsers && myDeptOk && editableSubtreeForMe && !userDeptInSubtree(dept, editableSubtreeForMe)) {
      setError('仅能维护本部门及下级组织内的用户');
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
    if (userDialog.mode === 'create') {
      if (!ufPassword.trim()) {
        setError('请输入初始密码');
      return;
      }
      if (!ufPasswordConfirm.trim()) {
        setError('请输入确认密码');
        return;
      }
      if (ufPassword !== ufPasswordConfirm) {
        setError('两次输入的密码不一致');
        return;
      }
    }
    if (currentRole !== 'admin' && userDialog.mode === 'create' && !roleNameAllowedInUserDialogForCreator(currentRole, role)) {
      setError('当前账号无权创建该角色');
      return;
    }
    if (currentRole !== 'admin' && userDialog.mode === 'edit' && userDialog.user) {
      const prev = String(userDialog.user.role || '').trim();
      if (role !== prev && !roleNameAllowedInUserDialogForCreator(currentRole, role)) {
        setError('当前账号无权将该用户改为所选角色');
        return;
      }
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
      setUfPassword('');
      setUfPasswordConfirm('');
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

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (deptFilter && listAllUsers) {
        const sub = adminDeptSubtree;
        if (sub && sub.length && !userDeptInSubtree(String(u.dept || ''), sub)) return false;
      }
      if (!q.trim()) return true;
      const s = q.trim().toLowerCase();
      return (
        String(u.name || '').toLowerCase().includes(s) ||
        String(u.username || '').toLowerCase().includes(s) ||
        String(u.dept || '').toLowerCase().includes(s) ||
        String(u.role || '').toLowerCase().includes(s)
      );
    });
  }, [users, deptFilter, listAllUsers, adminDeptSubtree, q]);

  const pagedUsers = useMemo(() => {
    const start = (userListPage - 1) * userPageSize;
    return filtered.slice(start, start + userPageSize);
  }, [filtered, userListPage, userPageSize]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(filtered.length / userPageSize) || 1);
    setUserListPage((p) => Math.min(Math.max(1, p), tp));
  }, [filtered.length, userPageSize]);

  const initial = (name: string) => {
    const t = String(name || '').trim();
    return t ? t[0] : '?';
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">用户管理</h1>
      </div>
      {!listAllUsers && !myDeptOk ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
          无法按部门列出用户：账号未设置「所属部门」。请超级管理员在「用户管理」中为您填写部门（须与「部门管理」中名称一致），保存后重新登录。
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-3 sm:gap-4">
          <div className="relative min-w-0 w-full sm:w-auto sm:max-w-md sm:flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索用户名、姓名、部门…"
              className="w-full min-w-0 rounded-lg border border-slate-200 py-2 pl-10 pr-4 outline-none focus:ring-2 focus:ring-indigo-500 sm:max-w-md"
            />
          </div>
          {listAllUsers ? (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              title="按组织树筛选：选中部门时包含该部门及全部下级部门内的人员"
              className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 outline-none sm:w-auto sm:min-w-[10rem]"
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
          className={`${btnPrimarySmFlex} w-full justify-center sm:w-auto sm:justify-start disabled:pointer-events-none disabled:opacity-50`}
        >
          <Plus className="h-4 w-4" /> 新增用户
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
                  ? '本部门及下级组织暂无用户'
                  : '暂无用户数据'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">姓名</th>
                    <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">手机号（登录）</th>
                    <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">所属部门</th>
                    <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">角色</th>
                    <th className="px-3 py-3 text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">状态</th>
                    <th className="px-3 py-3 text-right text-xs font-medium sm:px-6 sm:py-4 sm:text-sm">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedUsers.map((user) => {
                    const busy = updatingId === user.id;
                    const active = user.status === '正常';
                    return (
                      <tr key={user.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-3 py-3 font-bold text-slate-900 sm:px-6 sm:py-4">
                          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                              {initial(user.name)}
                            </div>
                            <span className="min-w-0 truncate">{user.name}</span>
                          </div>
                        </td>
                        <td className="max-w-[9rem] truncate px-3 py-3 font-mono text-xs text-slate-600 sm:max-w-none sm:px-6 sm:py-4">
                          {user.username}
                        </td>
                        <td className="max-w-[8rem] truncate px-3 py-3 text-slate-600 sm:max-w-none sm:px-6 sm:py-4">{user.dept}</td>
                        <td className="whitespace-nowrap px-3 py-3 sm:px-6 sm:py-4">
                          <span className="rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                            {user.role}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 sm:px-6 sm:py-4">
                          {active ? (
                            <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" /> 正常
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 font-medium text-slate-500">
                              <span className="h-2 w-2 rounded-full bg-slate-400" /> 停用
                            </span>
                          )}
                        </td>
                        <td className="space-x-2 whitespace-nowrap px-3 py-3 text-right sm:px-6 sm:py-4">
                          <button
                            type="button"
                            onClick={() => openUserEdit(user)}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void toggleStatus(user)}
                            className={
                              active
                                ? 'text-xs font-medium text-amber-700 hover:text-amber-900 disabled:opacity-50'
                                : 'text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50'
                            }
                          >
                            {busy ? '…' : active ? '停用' : '启用'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteUser(user)}
                            className="text-xs font-medium text-red-600 hover:text-red-800"
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListPaginationBar
              page={userListPage}
              pageSize={userPageSize}
              total={filtered.length}
              onPageChange={setUserListPage}
              onPageSizeChange={(n) => {
                setUserPageSize(n);
                setUserListPage(1);
              }}
            />
          </>
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
              className={btnSecondarySm}
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitUser()}
              className={btnSaveSm}
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
            {userDialog?.mode === 'create' && !roleAllowsNonMobileLoginUsername(ufRole) ? (
              <>
                手机号（即登录账号）
                <span className="text-red-500 font-medium ml-0.5" title="必填">
                  *
                </span>
              </>
            ) : (
              '登录账号'
            )}
          </label>
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
            required={userDialog?.mode === 'create' && !roleAllowsNonMobileLoginUsername(ufRole)}
            aria-required={userDialog?.mode === 'create' && !roleAllowsNonMobileLoginUsername(ufRole)}
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
            {userDialogRoleSelectOptions.length === 0 ? (
              <option value="招聘人员">招聘人员</option>
            ) : (
              userDialogRoleSelectOptions.map((r) => (
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
        {userDialog?.mode === 'edit' ? (
        <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">新密码（留空则不修改）</label>
          <input
            type="password"
            className={systemFieldClass}
            value={ufPassword}
            onChange={(e) => setUfPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">初始密码</label>
              <input
                type="password"
                className={systemFieldClass}
                value={ufPassword}
                onChange={(e) => setUfPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">确认密码</label>
              <input
                type="password"
                className={systemFieldClass}
                value={ufPasswordConfirm}
                onChange={(e) => setUfPasswordConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </>
        )}
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
          className={btnPrimarySmFlex}
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
              className={btnSecondarySm}
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitRole()}
              className={btnSaveSm}
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
        </div>
        <div className="border-t border-slate-100 pt-4 mt-2">
          <p className="text-xs font-semibold text-slate-700 mb-2">可见菜单</p>
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
  const [menuListPage, setMenuListPage] = useState(1);
  const [menuPageSize, setMenuPageSize] = useState(10);
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
  const pagedMenuRows = useMemo(() => {
    const start = (menuListPage - 1) * menuPageSize;
    return menuDisplayRows.slice(start, start + menuPageSize);
  }, [menuDisplayRows, menuListPage, menuPageSize]);

  useEffect(() => {
    setMenuListPage(1);
  }, [q]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(menuDisplayRows.length / menuPageSize) || 1);
    setMenuListPage((p) => Math.min(Math.max(1, p), tp));
  }, [menuDisplayRows.length, menuPageSize]);

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
          className={btnPrimarySmFlex}
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
          <>
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
                {pagedMenuRows.map(({ menu, depth }) => (
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
            <ListPaginationBar
              page={menuListPage}
              pageSize={menuPageSize}
              total={menuDisplayRows.length}
              onPageChange={setMenuListPage}
              onPageSizeChange={(n) => {
                setMenuPageSize(n);
                setMenuListPage(1);
              }}
            />
          </>
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
          <input className={systemFieldClass} value={mfPath} onChange={(e) => setMfPath(e.target.value)} />
        </div>
      </SystemCrudModal>
    </div>
  );
}
