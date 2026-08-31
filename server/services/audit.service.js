export function audit(req, action, details = {}) {
  const event = {
    level: 'info',
    event: 'management_audit',
    managementUserId: req.managementUser?.id,
    managementRole: req.managementUser?.role,
    action,
    platform: details.platform,
    targetId: details.targetId,
    timestamp: new Date().toISOString(),
    requestId: req.id,
    metadata: details.metadata,
  }
  console.log(JSON.stringify(event))
}
