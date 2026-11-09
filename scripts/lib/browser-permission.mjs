export const browserPermissionCode = 'BROWSER_EXECUTION_PERMISSION_REQUIRED';

// This host restriction aborts Chrome while macOS registers the application.
// Inspect it before launch; only the host's normal approval flow may lift it.
export function browserExecutionStatus({platform = process.platform, env = process.env} = {}) {
  return platform === 'darwin' && env.CODEX_SANDBOX === 'seatbelt'
    ? {status: 'permission_required', code: browserPermissionCode}
    : {status: 'no_known_restriction'};
}

export function assertBrowserExecutionAllowed(options) {
  if (browserExecutionStatus(options).status !== 'permission_required') return;
  const error = Error(`[${browserPermissionCode}] 当前 macOS 执行环境限制启动 Chrome。本次未启动浏览器；请由助手通过客户端正式授权流程取得本次浏览器命令的执行权限后继续。`);
  error.code = browserPermissionCode;
  throw error;
}
