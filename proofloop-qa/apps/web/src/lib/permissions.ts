// Mirrors requireRole() lists in apps/api/src/routes/*.routes.ts.
// UI hint only: the API enforces these against the DB role.
const PROJECT_CREATORS = ['ADMIN', 'QA_LEAD'];
const MODULE_CREATORS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
const REQUIREMENT_CREATORS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
const RISK_CREATORS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
const TEST_CASE_CREATORS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
// automation.routes.ts `writers` (create automation project, trigger run).
const AUTOMATION_WRITERS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
// environment.routes.ts POST /:projectId/environments.
const ENVIRONMENT_CREATORS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
// api-intelligence.routes.ts `writers` (create collection, create request).
const API_INTELLIGENCE_WRITERS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
// defect.routes.ts `writers` (create + update defects).
const DEFECT_WRITERS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];
const INTEGRATION_MANAGERS = ['ADMIN', 'QA_LEAD'];
// database-sentinel.routes.ts PUT .../database/connection (connection strings hold DB credentials).
const DATABASE_CONNECTION_MANAGERS = ['ADMIN', 'QA_LEAD'];
const TEST_CYCLE_WRITERS = ['ADMIN', 'QA_LEAD', 'QA_ENGINEER'];

export const canCreateProject = (role: string | undefined) => !!role && PROJECT_CREATORS.includes(role);
export const canCreateModule = (role: string | undefined) => !!role && MODULE_CREATORS.includes(role);
export const canCreateRequirement = (role: string | undefined) => !!role && REQUIREMENT_CREATORS.includes(role);
export const canCreateRisk = (role: string | undefined) => !!role && RISK_CREATORS.includes(role);
export const canCreateTestCase = (role: string | undefined) => !!role && TEST_CASE_CREATORS.includes(role);
export const canManageAutomation = (role: string | undefined) => !!role && AUTOMATION_WRITERS.includes(role);
export const canCreateEnvironment = (role: string | undefined) => !!role && ENVIRONMENT_CREATORS.includes(role);
export const canManageApiIntelligence = (role: string | undefined) => !!role && API_INTELLIGENCE_WRITERS.includes(role);
export const canManageDefects = (role: string | undefined) => !!role && DEFECT_WRITERS.includes(role);
export const canManageOrganization = (role: string | undefined) => role === 'ADMIN';
export const canManageIntegrations = (role: string | undefined) => !!role && INTEGRATION_MANAGERS.includes(role);
export const canManageDatabaseConnection = (role: string | undefined) => !!role && DATABASE_CONNECTION_MANAGERS.includes(role);
export const canManageTestCycles =(role: string | undefined) => !!role && TEST_CYCLE_WRITERS.includes(role);
