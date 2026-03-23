import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, Phone, Mic, Video, CheckCircle2, XCircle, 
  LayoutDashboard, Users, Settings, LogOut, Bot, 
  PhoneCall, MicOff, Loader2, ChevronRight, Play,
  Plus, Edit, Eye, X, Search, FileText, Award, Calendar, Briefcase, Folder, ChevronLeft, QrCode, Link, Copy
} from 'lucide-react';

// --- Mock Data & Types ---
type Project = {
  id: string;
  name: string;
  desc: string;
  status: '进行中' | '已结束';
  ownerId: string;
};

type Job = {
  id: string;
  projectId: string;
  title: string;
  department: string;
  status: '招聘中' | '已结束';
  jd: string;
  demand: number;
  location: string;
  skills: string;
  level: string;
};

type Candidate = {
  id: string;
  jobId: string;
  name: string;
  phone: string;
  time: string;
  score: number;
  status: '建议通过' | '待定' | '不匹配';
  overallFeedback: string;
  qa: { q: string; a: string; feedback: string }[];
};

const INITIAL_PROJECTS: Project[] = [
  { id: 'PRJ001', name: '2026春季校园招聘', status: '进行中', desc: '面向2026届应届毕业生的春季招聘计划，涵盖研发、产品、设计等多个方向。', ownerId: 'HR001' },
  { id: 'PRJ002', name: '2026 Q2 社会招聘', status: '进行中', desc: '各业务线核心骨干岗位及高级技术专家定向招聘。', ownerId: 'HR001' }
];

const INITIAL_JOBS: Job[] = [
  { 
    id: 'J001', projectId: 'PRJ001', title: '前端开发工程师 (校招)', department: '大前端团队', status: '招聘中', 
    jd: '1. 计算机相关专业本科及以上学历；\n2. 熟悉 HTML/CSS/JavaScript 基础；\n3. 了解 React 或 Vue 框架，有实际项目经验者优先；\n4. 具备良好的学习能力和团队协作精神。',
    demand: 10, location: '北京/上海/杭州', skills: 'React, Vue, JavaScript', level: '初级'
  },
  { 
    id: 'J002', projectId: 'PRJ001', title: 'Java后端工程师 (校招)', department: '业务中台', status: '招聘中', 
    jd: '1. 计算机相关专业本科及以上学历；\n2. 扎实的 Java 基础，了解 JVM 原理；\n3. 熟悉 Spring Boot、MySQL、Redis 等常用后端技术栈；\n4. 热爱编程，有技术博客或开源项目贡献者优先。',
    demand: 15, location: '北京/深圳', skills: 'Java, Spring Boot, MySQL', level: '初级'
  },
  { 
    id: 'J003', projectId: 'PRJ002', title: '高级前端架构师', department: '基础架构部', status: '招聘中', 
    jd: '1. 5年以上前端开发经验，熟练掌握 React 18 及底层原理；\n2. 丰富的复杂应用性能优化经验；\n3. 深入理解前端工程化（Vite/Webpack/Rollup）；\n4. 具备前端基础设施建设和架构演进能力。',
    demand: 2, location: '北京', skills: 'React, 架构设计, 性能优化', level: '高级/专家'
  }
];

const INITIAL_CANDIDATES: Candidate[] = [
  { 
    id: 'C001', jobId: 'J001', name: '张三', phone: '138****1234', time: '2026-03-22 10:00', score: 85, status: '建议通过',
    overallFeedback: '候选人基础扎实，对 React 有一定了解，并在校期间有相关项目实践。沟通表达清晰，具备较好的培养潜力，符合校招前端岗位要求。',
    qa: [
      { q: '请简述一下你在校期间做过的最满意的前端项目。', a: '我做过一个校园二手交易平台，使用 React 和 Tailwind CSS 开发，主要负责商品列表和详情页的渲染，并用 Context API 做了简单的状态管理。', feedback: '项目经验真实，能清晰表达自己负责的模块和使用的技术栈。' },
      { q: '在项目中遇到过什么跨域问题吗？是如何解决的？', a: '遇到过。本地开发时主要是通过 Vite 的 proxy 配置代理解决的。上线后是后端同学配置了 CORS 响应头来允许跨域请求。', feedback: '对跨域问题的常见解决方式有清晰的认知。' }
    ]
  },
  { 
    id: 'C002', jobId: 'J001', name: '李四', phone: '139****5678', time: '2026-03-22 11:30', score: 45, status: '不匹配',
    overallFeedback: '候选人前端基础较为薄弱，对 JavaScript 核心概念理解不深，暂不符合岗位要求。',
    qa: [
      { q: '请解释一下 JavaScript 中的闭包是什么？', a: '闭包好像就是函数里面套函数吧，具体怎么用我不太清楚，平时写代码没怎么用到。', feedback: '对 JS 核心概念理解不足。' }
    ]
  },
  { 
    id: 'C003', jobId: 'J003', name: '王五', phone: '137****9012', time: '2026-03-23 09:15', score: 92, status: '建议通过',
    overallFeedback: '资深前端开发者，对 React 底层原理和工程化有深刻理解，具备主导大型项目架构演进的能力，非常契合高级架构师岗位。',
    qa: [
      { q: '请谈谈你对前端工程化和构建工具（如Vite）的理解。', a: '前端工程化主要是为了提效。Vite 利用了浏览器原生的 ES Module，在开发环境下做到了极速冷启动和热更新，比传统的 Webpack 快很多。在生产环境则使用 Rollup 进行打包，保证产物体积和性能。', feedback: '准确指出了 Vite 的核心优势及生产/开发环境的差异，对工程化有清晰认知。' }
    ]
  }
];

type ViewState = 'role-select' | 'admin-dashboard' | 'candidate-login' | 'candidate-lobby' | 'candidate-interview' | 'candidate-result';

export default function App() {
  const [view, setView] = useState<ViewState>('role-select');
  
  // --- Admin State ---
  const [adminModule, setAdminModule] = useState<'workspace' | 'projects' | 'candidates' | 'system'>('workspace');
  const [adminLevel, setAdminLevel] = useState<'projects' | 'jobs' | 'candidates'>('projects');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [systemTab, setSystemTab] = useState<'users' | 'roles' | 'menus'>('users');

  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS);
  const [candidates, setCandidates] = useState<Candidate[]>(INITIAL_CANDIDATES);
  
  // Admin Modals State
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectForm, setNewProjectForm] = useState({ name: '', desc: '' });

  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showShareJob, setShowShareJob] = useState(false);
  const [sharingJob, setSharingJob] = useState<Job | null>(null);
  const [newJobForm, setNewJobForm] = useState({ title: '', department: '', jd: '', demand: 1, location: '', skills: '', level: '' });
  
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [viewingCandidate, setViewingCandidate] = useState<Candidate | null>(null);

  // --- Candidate Flow State ---
  const [candidateName, setCandidateName] = useState('');
  const [candidatePhone, setCandidatePhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const [qIndex, setQIndex] = useState(0);
  const [interviewPhase, setInterviewPhase] = useState<'ai-speaking' | 'waiting-user' | 'user-speaking'>('ai-speaking');
  const [displayedText, setDisplayedText] = useState('');
  const [userAnswerText, setUserAnswerText] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const [activeCandidateJobId, setActiveCandidateJobId] = useState<string | null>(null);
  const currentCandidateJob = jobs.find(j => j.id === activeCandidateJobId) || null;

  // Handle Camera for Candidate
  useEffect(() => {
    if (view === 'candidate-interview') {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(s => {
          setStream(s);
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(err => console.error("Camera access denied:", err));
    } else {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        setStream(null);
      }
    }
  }, [view]);

  // Simulate AI Speaking
  useEffect(() => {
    if (view === 'candidate-interview' && interviewPhase === 'ai-speaking') {
      setDisplayedText('');
      setUserAnswerText('');
      const mockQuestions = INITIAL_CANDIDATES[0].qa.map(q => q.q);
      const fullText = mockQuestions[qIndex] || "面试结束。";
      let i = 0;
      const timer = setInterval(() => {
        setDisplayedText(fullText.substring(0, i + 1));
        i++;
        if (i >= fullText.length) {
          clearInterval(timer);
          setTimeout(() => setInterviewPhase('waiting-user'), 500);
        }
      }, 50);
      return () => clearInterval(timer);
    }
  }, [view, interviewPhase, qIndex]);

  // Simulate User Speaking
  const handleUserSpeak = () => {
    setInterviewPhase('user-speaking');
    let i = 0;
    const mockAnswers = INITIAL_CANDIDATES[0].qa.map(q => q.a);
    const fullAnswer = mockAnswers[qIndex] || "谢谢。";
    const timer = setInterval(() => {
      setUserAnswerText(fullAnswer.substring(0, i + 1));
      i++;
      if (i >= fullAnswer.length) {
        clearInterval(timer);
        setTimeout(() => {
          if (qIndex < mockAnswers.length - 1) {
            setQIndex(prev => prev + 1);
            setInterviewPhase('ai-speaking');
          } else {
            setView('candidate-result');
          }
        }, 1500);
      }
    }, 50);
  };

  const resetCandidate = () => {
    setCandidateName('');
    setCandidatePhone('');
    setQIndex(0);
    setInterviewPhase('ai-speaking');
    setDisplayedText('');
    setUserAnswerText('');
  };

  // --- Admin Actions ---
  const handleCreateProject = () => {
    if (!newProjectForm.name) return;
    const newProj: Project = {
      id: `PRJ00${projects.length + 1}`,
      name: newProjectForm.name,
      desc: newProjectForm.desc,
      status: '进行中',
      ownerId: 'HR001' // Current user
    };
    setProjects([newProj, ...projects]);
    setShowCreateProject(false);
    setNewProjectForm({ name: '', desc: '' });
  };

  const handleCreateJob = () => {
    if (!newJobForm.title || !activeProjectId) return;
    const newJob: Job = {
      id: `J00${jobs.length + 1}`,
      projectId: activeProjectId,
      title: newJobForm.title,
      department: newJobForm.department || '默认部门',
      status: '招聘中',
      jd: newJobForm.jd,
      demand: newJobForm.demand,
      location: newJobForm.location,
      skills: newJobForm.skills,
      level: newJobForm.level
    };
    setJobs([newJob, ...jobs]);
    setShowCreateJob(false);
    setNewJobForm({ title: '', department: '', jd: '', demand: 1, location: '', skills: '', level: '' });
  };

  const handleSaveJD = () => {
    if (!editingJob) return;
    setJobs(jobs.map(j => j.id === editingJob.id ? editingJob : j));
    setEditingJob(null);
  };

  // --- Views ---

  const RoleSelectView = () => (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center border border-slate-100">
        <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-200 transform rotate-3">
          <Bot className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">AI 面试系统 MVP</h1>
        <p className="text-slate-500 mb-8 text-sm">请选择您要体验的角色视角</p>
        
        <div className="space-y-4">
          <button 
            onClick={() => setView('admin-dashboard')}
            className="w-full flex items-center justify-between p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <LayoutDashboard className="w-6 h-6" />
              </div>
              <div className="text-left">
                <div className="font-bold text-slate-900">企业 HR / 面试官</div>
                <div className="text-xs text-slate-500">管理项目、岗位与候选人</div>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-indigo-600" />
          </button>

          <button 
            onClick={() => { resetCandidate(); setView('candidate-login'); }}
            className="w-full flex items-center justify-between p-4 rounded-2xl border-2 border-slate-100 hover:border-emerald-600 hover:bg-emerald-50 transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <User className="w-6 h-6" />
              </div>
              <div className="text-left">
                <div className="font-bold text-slate-900">求职者 / 候选人</div>
                <div className="text-xs text-slate-500">体验沉浸式 AI 视频面试</div>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-emerald-600" />
          </button>
        </div>
      </div>
    </div>
  );

  const AdminDashboardView = () => {
    const activeProject = projects.find(p => p.id === activeProjectId);
    const activeJob = jobs.find(j => j.id === activeJobId);
    const currentJobs = jobs.filter(j => j.projectId === activeProjectId);
    const currentCandidates = candidates.filter(c => c.jobId === activeJobId);

    return (
      <div className="min-h-screen bg-slate-50 flex">
        {/* Sidebar */}
        <div className="w-64 bg-slate-900 text-white p-6 flex flex-col fixed h-full z-10">
          <div className="flex items-center gap-3 mb-12">
            <Bot className="w-8 h-8 text-indigo-400" />
            <span className="font-bold text-xl">AI HR Admin</span>
          </div>
          <nav className="space-y-2 flex-1">
            <button 
              onClick={() => setAdminModule('workspace')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${adminModule === 'workspace' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              <LayoutDashboard className="w-5 h-5"/> 个人工作台
            </button>
            <button 
              onClick={() => { setAdminModule('projects'); setAdminLevel('projects'); setActiveProjectId(null); setActiveJobId(null); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${adminModule === 'projects' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              <Folder className="w-5 h-5"/> 项目管理
            </button>
            <button 
              onClick={() => setAdminModule('candidates')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${adminModule === 'candidates' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              <Users className="w-5 h-5"/> 应聘管理
            </button>
            <button 
              onClick={() => setAdminModule('system')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${adminModule === 'system' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              <Settings className="w-5 h-5"/> 系统管理
            </button>
          </nav>
          <button onClick={() => setView('role-select')} className="flex items-center gap-3 text-slate-400 hover:text-white px-4 py-3 mt-auto transition-colors">
            <LogOut className="w-5 h-5"/> 返回角色选择
          </button>
        </div>
        
        {/* Main Content */}
        <div className="flex-1 ml-64 p-8 overflow-y-auto">
          
          {/* --- MODULE: WORKSPACE --- */}
          {adminModule === 'workspace' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-2xl font-bold text-slate-900 mb-8">个人工作台</h1>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <div className="text-slate-500 text-sm mb-2">负责项目数</div>
                  <div className="text-3xl font-bold text-slate-900">{projects.filter(p => p.ownerId === 'HR001').length}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <div className="text-slate-500 text-sm mb-2">管理岗位数</div>
                  <div className="text-3xl font-bold text-slate-900">{jobs.filter(j => projects.find(p => p.id === j.projectId)?.ownerId === 'HR001').length}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <div className="text-slate-500 text-sm mb-2">收到简历数</div>
                  <div className="text-3xl font-bold text-slate-900">{candidates.filter(c => jobs.find(j => j.id === c.jobId && projects.find(p => p.id === j.projectId)?.ownerId === 'HR001')).length}</div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <div className="text-slate-500 text-sm mb-2">建议通过人数</div>
                  <div className="text-3xl font-bold text-emerald-600">{candidates.filter(c => c.status === '建议通过' && jobs.find(j => j.id === c.jobId && projects.find(p => p.id === j.projectId)?.ownerId === 'HR001')).length}</div>
                </div>
              </div>

              <h2 className="text-lg font-bold text-slate-900 mb-4">近期面试候选人</h2>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="p-4 font-medium">姓名</th>
                      <th className="p-4 font-medium">应聘岗位</th>
                      <th className="p-4 font-medium">面试时间</th>
                      <th className="p-4 font-medium">AI 评分</th>
                      <th className="p-4 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.slice(0, 5).map(c => {
                      const job = jobs.find(j => j.id === c.jobId);
                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 font-medium text-slate-900">{c.name}</td>
                          <td className="p-4 text-slate-500">{job?.title}</td>
                          <td className="p-4 text-slate-500">{c.time}</td>
                          <td className="p-4 font-bold text-slate-900">
                            <span className={c.score >= 80 ? 'text-emerald-600' : c.score >= 60 ? 'text-amber-600' : 'text-rose-600'}>
                              {c.score}分
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`px-2.5 py-1 rounded text-xs font-medium ${
                              c.status === '建议通过' ? 'text-emerald-700 bg-emerald-100' : 
                              c.status === '待定' ? 'text-amber-700 bg-amber-100' : 
                              'text-rose-700 bg-rose-100'
                            }`}>
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* --- MODULE: PROJECTS --- */}
          {adminModule === 'projects' && (
            <>
              {/* Breadcrumbs */}
              <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
                <button 
                  onClick={() => { setAdminLevel('projects'); setActiveProjectId(null); setActiveJobId(null); }}
                  className={`hover:text-indigo-600 transition-colors ${adminLevel === 'projects' ? 'font-bold text-slate-900' : ''}`}
                >
                  所有项目
                </button>
                
                {activeProjectId && (
                  <>
                    <ChevronRight className="w-4 h-4" />
                    <button 
                      onClick={() => { setAdminLevel('jobs'); setActiveJobId(null); }}
                      className={`hover:text-indigo-600 transition-colors ${adminLevel === 'jobs' ? 'font-bold text-slate-900' : ''}`}
                    >
                      {activeProject?.name}
                    </button>
                  </>
                )}

                {activeJobId && (
                  <>
                    <ChevronRight className="w-4 h-4" />
                    <span className="font-bold text-slate-900">{activeJob?.title}</span>
                  </>
                )}
              </div>

              {/* --- TIER 1: PROJECTS --- */}
              {adminLevel === 'projects' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="flex justify-between items-center mb-8">
                    <h1 className="text-2xl font-bold text-slate-900">招聘项目管理</h1>
                    <button 
                      onClick={() => setShowCreateProject(true)}
                      className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 flex items-center gap-2 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> 新建项目
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {projects.filter(p => p.ownerId === 'HR001').map(proj => {
                      const projJobs = jobs.filter(j => j.projectId === proj.id);
                      const projCandidates = candidates.filter(c => projJobs.some(j => j.id === c.jobId));
                      return (
                        <div key={proj.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow flex flex-col">
                          <div className="flex justify-between items-start mb-4">
                            <h2 className="text-xl font-bold text-slate-900">{proj.name}</h2>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${proj.status === '进行中' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {proj.status}
                            </span>
                          </div>
                          <p className="text-slate-500 text-sm mb-6 flex-1">{proj.desc}</p>
                          
                          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                            <div className="flex gap-4 text-sm text-slate-500">
                              <span className="flex items-center gap-1"><Briefcase className="w-4 h-4"/> {projJobs.length} 个岗位</span>
                              <span className="flex items-center gap-1"><Users className="w-4 h-4"/> {projCandidates.length} 位候选人</span>
                            </div>
                            <button 
                              onClick={() => { setActiveProjectId(proj.id); setAdminLevel('jobs'); }}
                              className="text-indigo-600 font-medium text-sm hover:underline flex items-center gap-1"
                            >
                              进入项目 <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* --- TIER 2: JOBS --- */}
              {adminLevel === 'jobs' && activeProject && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="flex justify-between items-center mb-8">
                    <div>
                      <h1 className="text-2xl font-bold text-slate-900 mb-1">{activeProject.name} - 岗位管理</h1>
                      <p className="text-slate-500 text-sm">管理该项目下的所有招聘岗位及面试题库</p>
                    </div>
                    <button 
                      onClick={() => setShowCreateJob(true)}
                      className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 flex items-center gap-2 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> 添加岗位
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {currentJobs.length === 0 ? (
                      <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 border-dashed">
                        <Briefcase className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500">该项目下暂无岗位，请点击右上角添加。</p>
                      </div>
                    ) : (
                      currentJobs.map(job => {
                        const jobCandidates = candidates.filter(c => c.jobId === job.id);
                        return (
                          <div key={job.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:border-indigo-300 transition-colors flex items-center justify-between group">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-lg font-bold text-slate-900">{job.title}</h3>
                                <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded font-medium">{job.status}</span>
                                <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded font-medium">{job.level}</span>
                              </div>
                              <div className="flex items-center gap-4 text-slate-500 text-sm">
                                <span>部门：{job.department}</span>
                                <span>地点：{job.location}</span>
                                <span>需求：{job.demand}人</span>
                                <span>候选人：<span className="font-semibold text-indigo-600">{jobCandidates.length}</span> 人</span>
                              </div>
                            </div>
                            <button 
                              onClick={() => { setActiveJobId(job.id); setAdminLevel('candidates'); }}
                              className="bg-slate-50 text-indigo-600 px-4 py-2 rounded-lg font-medium hover:bg-indigo-50 transition-colors flex items-center gap-2 opacity-0 group-hover:opacity-100"
                            >
                              查看候选人 <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}

              {/* --- TIER 3: CANDIDATES & JD --- */}
              {adminLevel === 'candidates' && activeJob && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-slate-900">{activeJob.title} - 候选人追踪</h1>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => { setSharingJob(activeJob); setShowShareJob(true); }}
                        className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg font-medium hover:bg-indigo-100 flex items-center gap-2 transition-colors shadow-sm"
                      >
                        <QrCode className="w-4 h-4" /> 分享岗位
                      </button>
                      <button 
                        onClick={() => setEditingJob(activeJob)}
                        className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 flex items-center gap-2 transition-colors shadow-sm"
                      >
                        <Edit className="w-4 h-4" /> 编辑岗位要求 (JD)
                      </button>
                    </div>
                  </div>

                  {/* JD Preview Card */}
                  <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5 mb-8">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                        <Bot className="w-4 h-4" /> AI 面试出题依据 (JD)
                      </h3>
                      <div className="text-xs text-indigo-700 font-medium">
                        技能要求：{activeJob.skills}
                      </div>
                    </div>
                    <div className="text-sm text-indigo-800/80 whitespace-pre-line leading-relaxed">
                      {activeJob.jd || '暂无岗位要求，AI 将进行通用提问。'}
                    </div>
                  </div>

                  {/* Candidates Table */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold text-slate-900">候选人列表 ({currentCandidates.length})</h3>
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input type="text" placeholder="搜索姓名..." className="pl-9 pr-4 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-indigo-500 w-48" />
                      </div>
                    </div>
                    
                    {currentCandidates.length === 0 ? (
                      <div className="text-center py-12">
                        <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500">暂无候选人投递该岗位。</p>
                      </div>
                    ) : (
                      <table className="w-full text-left text-sm">
                        <thead className="text-slate-500 bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="p-4 font-medium">姓名</th>
                            <th className="p-4 font-medium">手机号</th>
                            <th className="p-4 font-medium">面试时间</th>
                            <th className="p-4 font-medium">AI 评分</th>
                            <th className="p-4 font-medium">状态</th>
                            <th className="p-4 font-medium text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {currentCandidates.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                              <td className="p-4 font-medium text-slate-900">{c.name}</td>
                              <td className="p-4 text-slate-500">{c.phone}</td>
                              <td className="p-4 text-slate-500">{c.time}</td>
                              <td className="p-4 font-bold text-slate-900">
                                <span className={c.score >= 80 ? 'text-emerald-600' : c.score >= 60 ? 'text-amber-600' : 'text-rose-600'}>
                                  {c.score}分
                                </span>
                              </td>
                              <td className="p-4">
                                <span className={`px-2.5 py-1 rounded text-xs font-medium ${
                                  c.status === '建议通过' ? 'text-emerald-700 bg-emerald-100' : 
                                  c.status === '待定' ? 'text-amber-700 bg-amber-100' : 
                                  'text-rose-700 bg-rose-100'
                                }`}>
                                  {c.status}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                <button 
                                  onClick={() => setViewingCandidate(c)}
                                  className="text-indigo-600 font-medium text-sm hover:underline flex items-center gap-1 justify-end w-full opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <FileText className="w-4 h-4" /> 查看报告
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </motion.div>
              )}
            </>
          )}

          {/* --- MODULE: CANDIDATES --- */}
          {adminModule === 'candidates' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-2xl font-bold text-slate-900 mb-8">应聘管理</h1>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">所有候选人</h3>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input type="text" placeholder="搜索姓名或岗位..." className="pl-9 pr-4 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-indigo-500 w-64" />
                  </div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="p-4 font-medium">姓名</th>
                      <th className="p-4 font-medium">应聘项目</th>
                      <th className="p-4 font-medium">应聘岗位</th>
                      <th className="p-4 font-medium">面试时间</th>
                      <th className="p-4 font-medium">AI 评分</th>
                      <th className="p-4 font-medium">状态</th>
                      <th className="p-4 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.filter(c => jobs.find(j => j.id === c.jobId && projects.find(p => p.id === j.projectId)?.ownerId === 'HR001')).map(c => {
                      const job = jobs.find(j => j.id === c.jobId);
                      const proj = projects.find(p => p.id === job?.projectId);
                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                          <td className="p-4 font-medium text-slate-900">{c.name}</td>
                          <td className="p-4 text-slate-500">{proj?.name}</td>
                          <td className="p-4 text-slate-500">{job?.title}</td>
                          <td className="p-4 text-slate-500">{c.time}</td>
                          <td className="p-4 font-bold text-slate-900">
                            <span className={c.score >= 80 ? 'text-emerald-600' : c.score >= 60 ? 'text-amber-600' : 'text-rose-600'}>
                              {c.score}分
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`px-2.5 py-1 rounded text-xs font-medium ${
                              c.status === '建议通过' ? 'text-emerald-700 bg-emerald-100' : 
                              c.status === '待定' ? 'text-amber-700 bg-amber-100' : 
                              'text-rose-700 bg-rose-100'
                            }`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <button 
                              onClick={() => setViewingCandidate(c)}
                              className="text-indigo-600 font-medium text-sm hover:underline flex items-center gap-1 justify-end w-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <FileText className="w-4 h-4" /> 查看报告
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* --- MODULE: SYSTEM --- */}
          {adminModule === 'system' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-2xl font-bold text-slate-900 mb-8">系统管理</h1>
              
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex border-b border-slate-200">
                  <button onClick={() => setSystemTab('users')} className={`px-6 py-4 text-sm font-medium transition-colors ${systemTab === 'users' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>用户管理</button>
                  <button onClick={() => setSystemTab('roles')} className={`px-6 py-4 text-sm font-medium transition-colors ${systemTab === 'roles' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>角色管理</button>
                  <button onClick={() => setSystemTab('menus')} className={`px-6 py-4 text-sm font-medium transition-colors ${systemTab === 'menus' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>菜单管理</button>
                </div>
                
                <div className="p-6">
                  {systemTab === 'users' && (
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-slate-900">系统用户列表</h3>
                        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">添加用户</button>
                      </div>
                      <table className="w-full text-left text-sm border border-slate-100 rounded-lg overflow-hidden">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr><th className="p-3">用户名</th><th className="p-3">角色</th><th className="p-3">状态</th><th className="p-3">操作</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          <tr><td className="p-3">admin</td><td className="p-3">超级管理员</td><td className="p-3"><span className="text-emerald-600">正常</span></td><td className="p-3 text-indigo-600 cursor-pointer">编辑</td></tr>
                          <tr><td className="p-3">hr_001</td><td className="p-3">招聘专员</td><td className="p-3"><span className="text-emerald-600">正常</span></td><td className="p-3 text-indigo-600 cursor-pointer">编辑</td></tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  {systemTab === 'roles' && (
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-slate-900">角色权限配置</h3>
                        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">添加角色</button>
                      </div>
                      <table className="w-full text-left text-sm border border-slate-100 rounded-lg overflow-hidden">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr><th className="p-3">角色名称</th><th className="p-3">描述</th><th className="p-3">操作</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          <tr><td className="p-3">超级管理员</td><td className="p-3">拥有系统所有权限</td><td className="p-3 text-indigo-600 cursor-pointer">配置权限</td></tr>
                          <tr><td className="p-3">招聘专员</td><td className="p-3">可管理分配给自己的招聘项目</td><td className="p-3 text-indigo-600 cursor-pointer">配置权限</td></tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  {systemTab === 'menus' && (
                    <div className="text-center py-12 text-slate-500">
                      <Settings className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p>菜单结构配置功能开发中...</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

        </div>

        {/* --- MODALS --- */}

        {/* Create Project Modal */}
        <AnimatePresence>
          {showCreateProject && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                  <h3 className="text-xl font-bold text-slate-900">新建招聘项目</h3>
                  <button onClick={() => setShowCreateProject(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">项目名称 *</label>
                    <input type="text" value={newProjectForm.name} onChange={e => setNewProjectForm({...newProjectForm, name: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600" placeholder="例如：2026春季校园招聘" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">项目描述</label>
                    <textarea value={newProjectForm.desc} onChange={e => setNewProjectForm({...newProjectForm, desc: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600 min-h-[80px]" placeholder="简要描述该招聘项目的背景或目标..." />
                  </div>
                </div>
                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                  <button onClick={() => setShowCreateProject(false)} className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors">取消</button>
                  <button onClick={handleCreateProject} disabled={!newProjectForm.name} className="px-5 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">创建项目</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Create Job Modal */}
        <AnimatePresence>
          {showCreateJob && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                  <h3 className="text-xl font-bold text-slate-900">添加招聘岗位</h3>
                  <button onClick={() => setShowCreateJob(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">岗位名称 *</label>
                    <input type="text" value={newJobForm.title} onChange={e => setNewJobForm({...newJobForm, title: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600" placeholder="例如：高级前端工程师" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">所属部门</label>
                      <input type="text" value={newJobForm.department} onChange={e => setNewJobForm({...newJobForm, department: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600" placeholder="例如：基础架构部" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">需求量</label>
                      <input type="number" min="1" value={newJobForm.demand} onChange={e => setNewJobForm({...newJobForm, demand: parseInt(e.target.value) || 1})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600" placeholder="招聘人数" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">岗位地址</label>
                      <input type="text" value={newJobForm.location} onChange={e => setNewJobForm({...newJobForm, location: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600" placeholder="例如：北京/上海" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">级别</label>
                      <input type="text" value={newJobForm.level} onChange={e => setNewJobForm({...newJobForm, level: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600" placeholder="例如：初级/高级/专家" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">核心技能</label>
                    <input type="text" value={newJobForm.skills} onChange={e => setNewJobForm({...newJobForm, skills: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600" placeholder="例如：React, Node.js, TypeScript" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">岗位要求 (JD)</label>
                    <textarea value={newJobForm.jd} onChange={e => setNewJobForm({...newJobForm, jd: e.target.value})} className="w-full border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-indigo-600 min-h-[120px]" placeholder="粘贴具体的岗位要求，AI将据此生成面试题..." />
                  </div>
                </div>
                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                  <button onClick={() => setShowCreateJob(false)} className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors">取消</button>
                  <button onClick={handleCreateJob} disabled={!newJobForm.title} className="px-5 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">添加岗位</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showShareJob && sharingJob && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden text-center">
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900">分享面试邀请</h3>
                  <button onClick={() => setShowShareJob(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
                </div>
                <div className="p-8">
                  <div className="w-48 h-48 bg-slate-100 rounded-xl mx-auto mb-6 flex items-center justify-center border-2 border-dashed border-slate-300">
                    <QrCode className="w-24 h-24 text-slate-400" />
                  </div>
                  <h4 className="font-bold text-slate-900 mb-1">{sharingJob.title}</h4>
                  <p className="text-slate-500 text-sm mb-6">候选人可扫描二维码，或使用下方邀请码进入面试</p>
                  
                  <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-between border border-slate-200">
                    <div className="text-left">
                      <div className="text-xs text-slate-500 mb-1">面试邀请码</div>
                      <div className="font-mono font-bold text-indigo-600 text-lg">{sharingJob.id}</div>
                    </div>
                    <button 
                      onClick={() => handleCopy(sharingJob.id)}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                    >
                      {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit JD Modal */}
        <AnimatePresence>
          {editingJob && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b border-slate-100">
                  <h3 className="text-xl font-bold text-slate-900">编辑岗位要求 (JD)</h3>
                  <button onClick={() => setEditingJob(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
                </div>
                <div className="p-6">
                  <p className="text-sm text-slate-500 mb-4">当前岗位：<span className="font-semibold text-slate-900">{editingJob.title}</span></p>
                  <textarea 
                    value={editingJob.jd} 
                    onChange={e => setEditingJob({...editingJob, jd: e.target.value})}
                    className="w-full border border-slate-200 rounded-lg p-4 focus:outline-none focus:border-indigo-600 min-h-[200px] text-sm leading-relaxed" 
                    placeholder="粘贴具体的岗位要求..."
                  />
                </div>
                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                  <button onClick={() => setEditingJob(null)} className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors">取消</button>
                  <button onClick={handleSaveJD} className="px-5 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">保存修改</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Candidate Detail Drawer */}
        <AnimatePresence>
          {viewingCandidate && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-end">
              <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col">
                <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white sticky top-0 z-10">
                  <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" /> 面试评估报告
                  </h3>
                  <button onClick={() => setViewingCandidate(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-3xl font-bold text-slate-900 mb-2">{viewingCandidate.name}</h2>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1"><Phone className="w-4 h-4"/> {viewingCandidate.phone}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-4 h-4"/> {viewingCandidate.time}</span>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className={`text-4xl font-black mb-1 ${viewingCandidate.score >= 80 ? 'text-emerald-500' : viewingCandidate.score >= 60 ? 'text-amber-500' : 'text-rose-500'}`}>
                        {viewingCandidate.score}
                      </div>
                      <div className={`text-xs font-bold px-2 py-1 rounded uppercase tracking-wider ${viewingCandidate.status === '建议通过' ? 'bg-emerald-100 text-emerald-700' : viewingCandidate.status === '待定' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                        {viewingCandidate.status}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Award className="w-4 h-4 text-indigo-600"/> 综合评价
                    </h4>
                    <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5 text-slate-700 leading-relaxed text-sm">
                      {viewingCandidate.overallFeedback}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Mic className="w-4 h-4 text-indigo-600"/> 面试逐字稿 & AI 点评
                    </h4>
                    <div className="space-y-6">
                      {viewingCandidate.qa.map((qa, idx) => (
                        <div key={idx} className="border border-slate-100 rounded-xl overflow-hidden">
                          <div className="bg-slate-50 p-4 border-b border-slate-100">
                            <div className="font-semibold text-slate-900 text-sm flex gap-2">
                              <span className="text-indigo-600">Q{idx + 1}.</span> {qa.q}
                            </div>
                          </div>
                          <div className="p-4 space-y-4">
                            <div>
                              <div className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">候选人回答</div>
                              <div className="text-sm text-slate-700 leading-relaxed">{qa.a}</div>
                            </div>
                            <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-3">
                              <div className="text-xs font-bold text-emerald-600 mb-1 uppercase tracking-wider">AI 评估</div>
                              <div className="text-sm text-emerald-800 leading-relaxed">{qa.feedback}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // --- Candidate Views ---
  const CandidateLoginView = () => (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-8 max-w-md mx-auto w-full">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">欢迎参加面试</h1>
          <p className="text-slate-500">请输入您的真实姓名和手机号进行登记</p>
        </div>
        
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">姓名</label>
            <input 
              type="text" value={candidateName} onChange={e => setCandidateName(e.target.value)}
              placeholder="请输入真实姓名" className="w-full border-b-2 border-slate-200 py-3 focus:outline-none focus:border-indigo-600 transition-colors text-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">手机号</label>
            <input 
              type="tel" value={candidatePhone} onChange={e => setCandidatePhone(e.target.value)}
              placeholder="请输入11位手机号" className="w-full border-b-2 border-slate-200 py-3 focus:outline-none focus:border-indigo-600 transition-colors text-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">面试邀请码</label>
            <input 
              type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)}
              placeholder="请输入面试邀请码 (如 J001)" className="w-full border-b-2 border-slate-200 py-3 focus:outline-none focus:border-indigo-600 transition-colors text-lg"
            />
          </div>
          
          <button 
            disabled={!candidateName || !candidatePhone || !inviteCode}
            onClick={() => {
              const matchedJob = jobs.find(j => j.id.toLowerCase() === inviteCode.trim().toLowerCase());
              if (matchedJob) {
                setActiveCandidateJobId(matchedJob.id);
                setView('candidate-lobby');
              } else {
                alert('无效的面试邀请码，请检查后重试');
              }
            }}
            className="w-full bg-indigo-600 text-white rounded-full py-4 font-bold text-lg mt-8 disabled:opacity-50 disabled:bg-slate-300 transition-all active:scale-95"
          >
            下一步
          </button>
        </div>
      </div>
      <button onClick={() => setView('role-select')} className="p-6 text-center text-slate-400 text-sm hover:text-slate-600">
        返回角色选择
      </button>
    </div>
  );

  const CandidateLobbyView = () => (
    <div className="min-h-screen bg-indigo-600 flex flex-col items-center justify-center p-6 text-white relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-32 h-32 bg-white/10 backdrop-blur-xl rounded-full flex items-center justify-center mb-8 border border-white/20 shadow-2xl">
          <Bot className="w-16 h-16 text-white animate-bounce" />
        </motion.div>
        
        <h1 className="text-3xl font-bold mb-2">你好，{candidateName}！</h1>
        <p className="text-indigo-100 mb-8 text-lg">欢迎参加 <span className="font-bold text-white">{currentCandidateJob?.title || '技术研发'}</span> 的初试。</p>
        
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 mb-10 border border-white/10 text-left w-full">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Video className="w-4 h-4"/> 面试须知</h3>
          <ul className="text-indigo-100 text-sm space-y-2">
            <li>• 本次面试由 AI 面试官全程主持。</li>
            <li>• 请确保处于安静环境，并允许使用摄像头和麦克风。</li>
            <li>• 面试过程将全程录音录像。</li>
          </ul>
        </div>

        <button 
          onClick={() => setView('candidate-interview')}
          className="w-full bg-white text-indigo-600 rounded-full py-4 font-bold text-lg shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <PhoneCall className="w-5 h-5" /> 接听面试邀请
        </button>
      </div>
    </div>
  );

  const CandidateInterviewView = () => (
    <div className="fixed inset-0 bg-black flex flex-col font-sans overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=1920&q=80" alt="AI Interviewer" className="w-full h-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/90"></div>
      </div>

      <div className="relative z-10 p-6 flex justify-between items-start pt-12">
        <div>
          <h2 className="text-white text-xl font-medium drop-shadow-md flex items-center gap-2"><Bot className="w-5 h-5 text-emerald-400" /> AI 面试官</h2>
          <div className="mt-2 inline-flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-white text-xs">面试中 {qIndex + 1}/{INITIAL_CANDIDATES[0].qa.length}</span>
          </div>
        </div>
        
        <div className="w-28 h-40 bg-zinc-800 rounded-xl overflow-hidden shadow-2xl border border-white/20 relative">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100" />
          {!stream && <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 text-xs gap-2"><Video className="w-6 h-6 opacity-50" /></div>}
        </div>
      </div>

      <div className="relative z-10 flex-1 flex flex-col justify-end p-6 pb-32 space-y-4">
        <AnimatePresence>
          {displayedText && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-black/50 backdrop-blur-md p-4 rounded-2xl rounded-tl-none max-w-[85%] border border-white/10">
              <p className="text-white text-lg leading-relaxed">{displayedText}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {userAnswerText && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="self-end bg-emerald-500/90 backdrop-blur-md p-4 rounded-2xl rounded-tr-none max-w-[85%] shadow-lg">
              <p className="text-white text-lg leading-relaxed">{userAnswerText}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black to-transparent z-20 flex justify-center items-center gap-12">
        <div className="flex flex-col items-center gap-2">
          <button 
            onClick={handleUserSpeak} disabled={interviewPhase !== 'waiting-user'}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${interviewPhase === 'user-speaking' ? 'bg-emerald-500 text-white shadow-[0_0_30px_rgba(16,185,129,0.6)] scale-110' : interviewPhase === 'waiting-user' ? 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-md border border-white/30' : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/10'}`}
          >
            {interviewPhase === 'user-speaking' ? (
              <div className="flex gap-1 items-center">
                <div className="w-1 h-3 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1 h-5 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1 h-3 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            ) : <Mic className="w-7 h-7" />}
          </button>
          <span className="text-white/70 text-xs font-medium">{interviewPhase === 'ai-speaking' ? 'AI 提问中...' : interviewPhase === 'waiting-user' ? '点击模拟回答' : '识别中...'}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button onClick={() => setView('candidate-result')} className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95">
            <Phone className="w-7 h-7 transform rotate-[135deg]" />
          </button>
          <span className="text-white/70 text-xs font-medium">结束面试</span>
        </div>
      </div>
    </div>
  );

  const CandidateResultView = () => (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
        <div className="bg-emerald-50 p-8 text-center border-b border-emerald-100">
          <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm"><CheckCircle2 className="w-12 h-12 text-emerald-500" /></div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">初试完成！</h1>
          <p className="text-emerald-700 text-sm">感谢 {candidateName} 的参与。</p>
        </div>
        <div className="p-8 text-center">
          <p className="text-slate-600 mb-8 leading-relaxed">您的面试记录已同步至 HR 后台。<br/>HR 将在 1-3 个工作日内与您联系，安排下一轮复试，请保持手机畅通。</p>
          <button onClick={() => setView('role-select')} className="w-full bg-slate-900 text-white rounded-full py-4 font-bold hover:bg-slate-800 transition-colors">返回首页</button>
        </div>
      </motion.div>
    </div>
  );

  return (
    <AnimatePresence mode="wait">
      <motion.div key={view} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="min-h-screen">
        {view === 'role-select' && <RoleSelectView />}
        {view === 'admin-dashboard' && <AdminDashboardView />}
        {view === 'candidate-login' && <CandidateLoginView />}
        {view === 'candidate-lobby' && <CandidateLobbyView />}
        {view === 'candidate-interview' && <CandidateInterviewView />}
        {view === 'candidate-result' && <CandidateResultView />}
      </motion.div>
    </AnimatePresence>
  );
}
