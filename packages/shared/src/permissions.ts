/**
 * Permission catalogue. Codes are `<module>.<resource>.<action>`.
 * The DB `permissions` table is seeded from this list; never invent codes elsewhere.
 */
export const PERMISSIONS = {
  ORG_CAMPUS_READ: 'org.campus.read',
  ORG_CAMPUS_CREATE: 'org.campus.create',
  ORG_CAMPUS_UPDATE: 'org.campus.update',
  IAM_USER_READ: 'iam.user.read',
  IAM_USER_INVITE: 'iam.user.invite',
  AUDIT_LOG_READ: 'audit.log.read',
  ORG_SETTINGS_READ: 'org.settings.read',
  ORG_SETTINGS_UPDATE: 'org.settings.update',
  ORG_NUMBERING_MANAGE: 'org.numbering.manage',
  FILES_FILE_UPLOAD: 'files.file.upload',
  FILES_FILE_READ: 'files.file.read',
  APPROVALS_RULE_MANAGE: 'approvals.rule.manage',
  APPROVALS_REQUEST_READ: 'approvals.request.read',
  ORG_ACADEMIC_READ: 'org.academic.read',
  ORG_ACADEMIC_MANAGE: 'org.academic.manage',
  ADM_ENQUIRY_MANAGE: 'admissions.enquiry.manage',
  ADM_APPLICATION_MANAGE: 'admissions.application.manage',
  ADM_APPLICATION_DECIDE: 'admissions.application.decide',
  ADM_ENROL: 'admissions.enrol',
  STU_STUDENT_READ: 'students.student.read',
  STU_STUDENT_MANAGE: 'students.student.manage',
  FEE_READ: 'fees.fee.read',
  FEE_SETUP_MANAGE: 'fees.setup.manage',
  FEE_BILL: 'fees.invoice.manage',
  FEE_CONCESSION_REQUEST: 'fees.concession.request',
  FEE_COLLECT: 'fees.payment.collect',
  FEE_RECEIPT_CANCEL: 'fees.payment.cancel',
  STU_PROMOTE: 'students.promotion.run',
  STU_TC_ISSUE: 'students.tc.issue',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOGUE: { code: PermissionCode; module: string; description: string }[] = [
  { code: PERMISSIONS.ORG_CAMPUS_READ, module: 'SETUP', description: 'View campuses' },
  { code: PERMISSIONS.ORG_CAMPUS_CREATE, module: 'SETUP', description: 'Create campuses' },
  { code: PERMISSIONS.ORG_CAMPUS_UPDATE, module: 'SETUP', description: 'Edit campuses' },
  { code: PERMISSIONS.IAM_USER_READ, module: 'USERS', description: 'View users of the institution' },
  { code: PERMISSIONS.IAM_USER_INVITE, module: 'USERS', description: 'Invite users and assign roles' },
  { code: PERMISSIONS.AUDIT_LOG_READ, module: 'AUDIT', description: 'View audit log' },
  { code: PERMISSIONS.ORG_SETTINGS_READ, module: 'SETUP', description: 'View institution and campus settings' },
  { code: PERMISSIONS.ORG_SETTINGS_UPDATE, module: 'SETUP', description: 'Change institution and campus settings' },
  { code: PERMISSIONS.ORG_NUMBERING_MANAGE, module: 'SETUP', description: 'Configure document number series' },
  { code: PERMISSIONS.FILES_FILE_UPLOAD, module: 'FILES', description: 'Upload documents' },
  { code: PERMISSIONS.FILES_FILE_READ, module: 'FILES', description: 'View and download documents' },
  { code: PERMISSIONS.APPROVALS_RULE_MANAGE, module: 'APPROVALS', description: 'Configure who approves what' },
  { code: PERMISSIONS.APPROVALS_REQUEST_READ, module: 'APPROVALS', description: 'View all approval requests of the institution' },
  { code: PERMISSIONS.ORG_ACADEMIC_READ, module: 'SETUP', description: 'View academic years, departments and holidays' },
  { code: PERMISSIONS.ORG_ACADEMIC_MANAGE, module: 'SETUP', description: 'Manage academic years, departments and holidays' },
  { code: PERMISSIONS.ADM_ENQUIRY_MANAGE, module: 'ADMISSIONS', description: 'Record and follow up admission enquiries' },
  { code: PERMISSIONS.ADM_APPLICATION_MANAGE, module: 'ADMISSIONS', description: 'Enter and edit admission applications' },
  { code: PERMISSIONS.ADM_APPLICATION_DECIDE, module: 'ADMISSIONS', description: 'Approve, reject or waitlist applications' },
  { code: PERMISSIONS.ADM_ENROL, module: 'ADMISSIONS', description: 'Enrol approved applicants as students' },
  { code: PERMISSIONS.STU_STUDENT_READ, module: 'STUDENTS', description: 'View student records' },
  { code: PERMISSIONS.STU_STUDENT_MANAGE, module: 'STUDENTS', description: 'Edit student records' },
  { code: PERMISSIONS.FEE_READ, module: 'FEES', description: 'View fee set-up, bills and dues' },
  { code: PERMISSIONS.FEE_SETUP_MANAGE, module: 'FEES', description: 'Set up fee heads, fee structures and late-fee rules' },
  { code: PERMISSIONS.FEE_BILL, module: 'FEES', description: 'Assign fees, create and cancel bills, add extra charges' },
  { code: PERMISSIONS.FEE_CONCESSION_REQUEST, module: 'FEES', description: 'Ask for fee concessions (decided through approvals)' },
  { code: PERMISSIONS.FEE_COLLECT, module: 'FEES', description: 'Collect fees at the counter and run a cash counter' },
  { code: PERMISSIONS.FEE_RECEIPT_CANCEL, module: 'FEES', description: 'Cancel receipts and record bounced cheques' },
  { code: PERMISSIONS.STU_PROMOTE, module: 'STUDENTS', description: 'Promote students to the next class at year end' },
  { code: PERMISSIONS.STU_TC_ISSUE, module: 'STUDENTS', description: 'Issue Transfer Certificates' },
];

/** System roles created for every new tenant. */
export const SYSTEM_ROLES: { code: string; name: string; permissions: PermissionCode[] }[] = [
  { code: 'INSTITUTION_ADMIN', name: 'Institution Admin', permissions: PERMISSION_CATALOGUE.map((p) => p.code) },
  { code: 'CAMPUS_VIEWER', name: 'Campus Viewer', permissions: [PERMISSIONS.ORG_CAMPUS_READ, PERMISSIONS.ORG_ACADEMIC_READ] },
];

/** Platform (SaaS operator) roles live on users.platform_role, not in tenant roles. */
export const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPPORT'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
