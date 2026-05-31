type Level = 'info' | 'warn' | 'error';

function emit(level: Level, module: string, event: string, data?: unknown) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, module, event, ...((data && typeof data === 'object') ? data : { data }) });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  info: (module: string, event: string, data?: unknown) => emit('info', module, event, data),
  warn: (module: string, event: string, data?: unknown) => emit('warn', module, event, data),
  error: (module: string, event: string, data?: unknown) => emit('error', module, event, data),
};
