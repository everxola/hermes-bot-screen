/**
 * Bot Screen plugin — copy. English + Chinese, chosen from the dashboard's
 * active locale (`SDK.useI18n()`), falling back to English.
 */

export interface ScreenCopy {
  title: string
  subtitle: string
  intro: string
  running: string
  stopped: string
  start: string
  starting: string
  stopping: string
  stop: string
  stoppedTitle: string
  stoppedBody: string
  unavailableTitle: string
  unavailableBody: string
  unsupportedTitle: string
  unsupportedBody: string
  notInstalledTitle: string
  notInstalledBody: string
  agentControls: string
  youControl: string
  otherControls: string
  takeOver: string
  handBack: string
  handBackForce: string
  reconnect: string
  attaching: string
  streamLost: string
  controlTaken: string
  desktopGone: string
  badTicket: string
  notAllowed: string
  reconnectGaveUp: string
  fit: string
  actual: string
  fullscreen: string
  exitFullscreen: string
  keyboardHint: string
  readonlyHint: string
  pausedNote: string
  panHint: string
  reason: string
  display: string
  geometry: string
  profile: string
  dockShow: string
  dockHide: string
  resizeDock: string
  openInPage: string
  clipboardFromDesktop: string
  copy: string
  copied: string
  copyFailed: string
  dismiss: string
  quality: string
  qualityAuto: string
  qualitySaver: string
  qualityBalanced: string
  qualitySharp: string
  hudTitle: string
  screenshot: string
  sendToDesktop: string
  sendTextPlaceholder: string
  send: string
  sent: string
  textTooLong: string
  keyEsc: string
  keyTab: string
  keyEnter: string
  keyBackspace: string
  keySuper: string
  keyLeft: string
  keyRight: string
  keyUp: string
  keyDown: string
}

const en: ScreenCopy = {
  title: 'Bot Screen',
  subtitle: 'agent desktop',
  intro:
    "Live view of this profile's headless desktop — the same screen the agent's computer_use tools drive. Watching is read-only; Take over gives you the mouse and keyboard, and the agent's screen actions stay paused until you hand control back.",
  running: 'Running',
  stopped: 'Stopped',
  start: 'Start desktop',
  starting: 'Starting…',
  stopping: 'Stopping…',
  stop: 'Stop desktop',
  stoppedTitle: 'The desktop is stopped',
  stoppedBody: "Start it to watch and drive the agent's screen.",
  unavailableTitle: 'Bot Screen is unavailable',
  unavailableBody: 'This Hermes build does not expose the display.* methods.',
  unsupportedTitle: 'Bot Screen is unavailable on this host',
  unsupportedBody: 'This host cannot run the headless desktop (Linux gateway hosts only).',
  notInstalledTitle: 'The desktop stack is not installed',
  notInstalledBody: 'Install the Xvnc/Xfce packages on this host to use Bot Screen.',
  agentControls: 'Agent has control',
  youControl: 'You have control',
  otherControls: 'Another viewer has control',
  takeOver: 'Take over',
  handBack: 'Hand back',
  handBackForce: 'Hand back (force)',
  reconnect: 'Reconnect',
  attaching: 'Attaching to the desktop…',
  streamLost: 'The desktop stream was lost.',
  controlTaken: 'Another viewer took control of this screen.',
  desktopGone: 'The desktop is not running.',
  badTicket: 'The screen ticket expired — reconnecting…',
  notAllowed: "The dashboard's host/origin policy refused this connection.",
  reconnectGaveUp: 'Reconnect gave up after several attempts — use Reconnect.',
  fit: 'Fit to window',
  actual: 'Actual size',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  keyboardHint: 'Click the screen to focus it — keys and pointer input reach the desktop only while you hold control.',
  readonlyHint: 'Read-only: watching never moves the agent’s mouse or keyboard.',
  pausedNote: 'The agent’s screen control is paused while you hold control.',
  panHint: 'Actual size: drag the screen to pan it (while you hold control, dragging acts on the desktop instead).',
  reason: 'Agent request',
  display: 'Display',
  geometry: 'Geometry',
  profile: 'Profile',
  dockShow: 'Show the desktop',
  dockHide: 'Hide the desktop',
  resizeDock: 'Drag to resize the desktop strip (double-click resets)',
  openInPage: 'Open the Screen page',
  clipboardFromDesktop: 'Desktop clipboard',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copying is blocked by the browser — select the text and copy manually.',
  dismiss: 'Dismiss',
  quality: 'Stream quality',
  qualityAuto: 'Auto (adaptive)',
  qualitySaver: 'Low bandwidth',
  qualityBalanced: 'Balanced',
  qualitySharp: 'Sharp',
  hudTitle: 'Approximate stream rate (frame starts/s) and bandwidth',
  screenshot: 'Save a screenshot (PNG)',
  sendToDesktop: 'Send text to the desktop clipboard — then press Ctrl+V inside the desktop',
  sendTextPlaceholder: 'Type text (CJK ok), Enter sends',
  send: 'Send',
  sent: 'Sent ✓',
  textTooLong: 'Text is too long for the desktop clipboard (256 KB max).',
  keyEsc: 'Esc',
  keyTab: 'Tab',
  keyEnter: 'Enter',
  keyBackspace: 'Backspace',
  keySuper: 'Super (open the desktop menu)',
  keyLeft: 'Left arrow',
  keyRight: 'Right arrow',
  keyUp: 'Up arrow',
  keyDown: 'Down arrow'
}

const zh: ScreenCopy = {
  title: 'Bot Screen 桌面',
  subtitle: 'Agent 桌面',
  intro:
    '当前 profile 的无头桌面实时画面 —— 也就是 Agent 的 computer_use 工具操作的那块屏幕。默认只读观看；点击「接管」后可用鼠标键盘操作，期间 Agent 的屏幕操作会暂停，直到你点击「交还」。',
  running: '运行中',
  stopped: '已停止',
  start: '启动桌面',
  starting: '启动中…',
  stopping: '停止中…',
  stop: '停止桌面',
  stoppedTitle: '桌面未运行',
  stoppedBody: '启动后即可观看并操作 Agent 的桌面。',
  unavailableTitle: 'Bot Screen 不可用',
  unavailableBody: '当前 Hermes 版本未提供 display.* 接口。',
  unsupportedTitle: '此主机不支持 Bot Screen',
  unsupportedBody: '当前主机无法运行无头桌面（仅支持 Linux 网关主机）。',
  notInstalledTitle: '未安装桌面组件',
  notInstalledBody: '请在本机安装 Xvnc/Xfce 软件包后使用 Bot Screen。',
  agentControls: 'Agent 持有控制权',
  youControl: '你持有控制权',
  otherControls: '其他观看者持有控制权',
  takeOver: '接管',
  handBack: '交还',
  handBackForce: '强制交还',
  reconnect: '重新连接',
  attaching: '正在连接桌面…',
  streamLost: '桌面画面已中断。',
  controlTaken: '其他观看者接管了这块屏幕。',
  desktopGone: '桌面未运行。',
  badTicket: '连接票据已过期 — 正在重新连接…',
  notAllowed: '浏览器被 Dashboard 的主机/来源策略拒绝。',
  reconnectGaveUp: '多次重连均失败 — 请点击「重新连接」。',
  fit: '适应窗口',
  actual: '原始尺寸',
  fullscreen: '全屏',
  exitFullscreen: '退出全屏',
  keyboardHint: '点击画面即可聚焦；仅在你持有控制权时，键盘与鼠标事件才会送达桌面。',
  readonlyHint: '只读：观看不会移动 Agent 的鼠标或键盘。',
  pausedNote: '你持有控制权期间，Agent 的屏幕操作已暂停。',
  panHint: '原始尺寸：观看时拖动画面可平移视图（持控制权时拖动直接作用于桌面）。',
  reason: 'Agent 请求',
  display: '显示号',
  geometry: '分辨率',
  profile: '配置',
  dockShow: '显示桌面',
  dockHide: '隐藏桌面',
  resizeDock: '拖动调整高度（双击恢复默认）',
  openInPage: '打开 Screen 页',
  clipboardFromDesktop: '桌面剪贴板',
  copy: '复制',
  copied: '已复制',
  copyFailed: '浏览器拒绝了复制 — 请手动选中文本复制。',
  dismiss: '忽略',
  quality: '画面质量',
  qualityAuto: '自动（自适应）',
  qualitySaver: '省流量',
  qualityBalanced: '均衡',
  qualitySharp: '清晰',
  hudTitle: '画面更新率与带宽（近似值）',
  screenshot: '截图（下载 PNG）',
  sendToDesktop: '把文本发到桌面剪贴板 — 随后在桌面里按 Ctrl+V',
  sendTextPlaceholder: '输入文本（支持中文），回车发送',
  send: '发送',
  sent: '已发送 ✓',
  textTooLong: '文本过长（桌面剪贴板上限 256 KB）。',
  keyEsc: 'Esc',
  keyTab: 'Tab',
  keyEnter: '回车',
  keyBackspace: '退格',
  keySuper: 'Super（打开桌面菜单）',
  keyLeft: '左方向键',
  keyRight: '右方向键',
  keyUp: '上方向键',
  keyDown: '下方向键'
}

export function screenCopy(locale?: string): ScreenCopy {
  return (locale || '').toLowerCase().startsWith('zh') ? zh : en
}
