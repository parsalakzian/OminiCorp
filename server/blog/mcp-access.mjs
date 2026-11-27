export const accessModes = {
  read: { writeAccess: false, publishAccess: false },
  write: { writeAccess: true, publishAccess: false },
  full: { writeAccess: true, publishAccess: true },
};

export function accessMode(write, publish) {
  return write ? (publish ? 'full' : 'write') : 'read';
}

export function accessFromForm(params, fallback = 'read') {
  const selected = params.get('access');
  if (selected !== null) {
    if (!Object.hasOwn(accessModes, selected)) throw new Error('Invalid MCP access level');
    return accessModes[selected];
  }
  if (!params.has('writeAccess') && !params.has('publishAccess')) return accessModes[fallback];
  return accessModes[accessMode(params.get('writeAccess') === 'on', params.get('publishAccess') === 'on')];
}

export function effectiveAccess(settings, credential) {
  const writeAccess = Boolean(settings.mcp && settings.mcpWrite && credential?.writeAccess);
  return { writeAccess, publishAccess: Boolean(writeAccess && settings.mcpPublish && credential?.publishAccess) };
}
