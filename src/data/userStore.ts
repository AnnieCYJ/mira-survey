/**
 * userStore —— 账户登录态 + 用户基础资料（本地持久化）
 * ---------------------------------------------------------------------------
 * ★ 定位：在没有后端账号体系之前，先用 expo-file-system 的 KV（prefs.ts）做
 *   「本地 mock 账号」。接口与真实后端对齐，后续接入云端时只需把 store 内部
 *   换成网络请求，调用方（LoginScreen / OnboardingScreen / AuthGate）零改动。
 *
 * 数据分两份：
 *   1) mira_accounts_v1   —— 已注册账号表 { [手机号]: { accountName, password } }
 *                           仅用于「注册 / 登录校验」，密码为本地明文占位，**非生产级**。
 *   2) mira_user_session_v1 —— 当前登录会话 { loggedIn, onboardingDone, account, profile }
 *
 * ⚠️ 安全说明：本地明文存密码只是 MVP 演示；上线前必须替换为：
 *   手机号 + 短信验证码（服务端校验）或 OAuth，密码不得落本地。
 */
import { getItem, setItem } from '../utils/prefs';

export type Gender = 'female' | 'male' | 'undisclosed';
export type SleepHabit = 'early' | 'late' | 'irregular';
export type ExerciseHabit = 'rare' | 'weekly12' | 'weekly3plus';
export type WorkRhythm = 'sedentary' | 'active' | 'highintensity';

export interface UserAccount {
  phone: string;
  accountName: string;
}

export interface PeriodInfo {
  /** 最近一次生理期开始日期（ISO YYYY-MM-DD） */
  lastStart?: string;
  /** 最近一次生理期结束日期（ISO YYYY-MM-DD） */
  lastEnd?: string;
  /** 周期是否规律 */
  regular?: boolean;
  /** 平均周期天数（默认 28） */
  cycleDays?: number;
}

export interface UserProfile {
  gender?: Gender;
  age?: number;
  height?: number; // cm
  weight?: number; // kg
  sleepHabit?: SleepHabit;
  exerciseHabit?: ExerciseHabit;
  workRhythm?: WorkRhythm;
  /** 女性专属：最近一次生理期与周期信息（Onboarding 选「女」后追问采集） */
  period?: PeriodInfo;
}

export interface UserSession {
  loggedIn: boolean;
  onboardingDone: boolean;
  account?: UserAccount;
  profile?: UserProfile;
}

interface AccountRecord {
  accountName: string;
  password: string;
}

const SESSION_KEY = 'mira_user_session_v1';
const ACCOUNTS_KEY = 'mira_accounts_v1';

/** 演示验证码（无短信后端，仅 MVP 占位；真实环境由服务端下发）。 */
export const DEMO_CODE = '123456';

// ── 会话变更通知（供 AuthGate 在 signOut / 等操作后即时回落登录页）─────────────
type Listener = () => void;
const listeners = new Set<Listener>();
export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function emitSessionChange() {
  listeners.forEach((l) => l());
}

// ── 底层读写 ──────────────────────────────────────────────────────────────
async function loadSession(): Promise<UserSession> {
  const raw = await getItem(SESSION_KEY);
  if (!raw) return { loggedIn: false, onboardingDone: false };
  try {
    const p = JSON.parse(raw);
    return {
      loggedIn: !!p.loggedIn,
      onboardingDone: !!p.onboardingDone,
      account: p.account,
      profile: p.profile,
    };
  } catch {
    return { loggedIn: false, onboardingDone: false };
  }
}

async function saveSession(s: UserSession): Promise<void> {
  await setItem(SESSION_KEY, JSON.stringify(s));
}

async function loadAccounts(): Promise<Record<string, AccountRecord>> {
  const raw = await getItem(ACCOUNTS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveAccounts(a: Record<string, AccountRecord>): Promise<void> {
  await setItem(ACCOUNTS_KEY, JSON.stringify(a));
}

// ── 对外 API ───────────────────────────────────────────────────────────────
export const userStore = {
  loadSession,

  /** 注册：写入账号表并直接登录。返回错误文案（null = 成功）。 */
  async register(
    phone: string,
    accountName: string,
    password: string,
  ): Promise<string | null> {
    const accounts = await loadAccounts();
    if (accounts[phone]) return '该手机号已注册，请直接登录';
    accounts[phone] = { accountName, password };
    await saveAccounts(accounts);
    await saveSession({
      loggedIn: true,
      onboardingDone: false,
      account: { phone, accountName },
      profile: {},
    });
    return null;
  },

  /** 登录：校验手机号 + 密码。返回错误文案（null = 成功）。 */
  async login(phone: string, password: string): Promise<string | null> {
    const accounts = await loadAccounts();
    const rec = accounts[phone];
    if (!rec) return '账号不存在，请先注册';
    if (rec.password !== password) return '密码不正确';
    await saveSession({
      loggedIn: true,
      onboardingDone: false,
      account: { phone, accountName: rec.accountName },
      profile: {},
    });
    return null;
  },

  /** 首次资料收集完成：标记 onboardingDone 并写入 profile。 */
  async completeOnboarding(profile: UserProfile): Promise<void> {
    const prev = await loadSession();
    await saveSession({
      ...prev,
      onboardingDone: true,
      profile: { ...(prev.profile || {}), ...profile },
    });
  },

  /** 退出登录：保留账号表与已填资料，仅清登录态（重新登录直达主页）。 */
  async signOut(): Promise<void> {
    const prev = await loadSession();
    await saveSession({
      ...prev,
      loggedIn: false,
    });
    emitSessionChange();
  },

  /** 调试用：清空全部（账号 + 会话 + 资料），回到首次启动。 */
  async resetAll(): Promise<void> {
    await saveAccounts({});
    await saveSession({ loggedIn: false, onboardingDone: false });
    emitSessionChange();
  },
};

// 字段标签（供 UI 复用）
export const GENDER_LABEL: Record<Gender, string> = {
  female: '女',
  male: '男',
  undisclosed: '不愿透露',
};
export const SLEEP_LABEL: Record<SleepHabit, string> = {
  early: '早睡早起',
  late: '经常熬夜',
  irregular: '作息不规律',
};
export const EXERCISE_LABEL: Record<ExerciseHabit, string> = {
  rare: '很少运动',
  weekly12: '每周 1–2 次',
  weekly3plus: '每周 3 次以上',
};
export const WORK_LABEL: Record<WorkRhythm, string> = {
  sedentary: '久坐办公',
  active: '经常走动',
  highintensity: '高强度奔波',
};
