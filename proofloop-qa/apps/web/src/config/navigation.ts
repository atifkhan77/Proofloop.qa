import {
  LayoutDashboard, Brain, FileText, AlertTriangle, TestTube,
  Settings, Bot, Globe, Database, FileSearch, ShieldAlert,
  Bug, History, CheckCircle, BarChart, Network,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  description: string;
}

export const navigation: NavItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, description: 'Quality overview across projects.' },
  { name: 'AI QA Brain', path: '/ai-brain', icon: Brain, description: 'AI assistant for QA analysis and generation.' },
  { name: 'Requirement Intelligence', path: '/requirements', icon: FileText, description: 'Requirements, acceptance criteria and traceability.' },
  { name: 'Risk Analysis', path: '/risks', icon: AlertTriangle, description: 'Probability × impact risk scoring and mitigation.' },
  { name: 'Test Case Studio', path: '/test-cases', icon: TestTube, description: 'Design and manage test cases and steps.' },
  { name: 'Automation Lab', path: '/automation', icon: Bot, description: 'Playwright automation authoring and runs.' },
  { name: 'API Intelligence', path: '/api-collections', icon: Globe, description: 'API test coverage and contract checks.' },
  { name: 'Database Sentinel', path: '/database', icon: Database, description: 'Data integrity and database validation.' },
  { name: 'Evidence Explorer', path: '/evidence', icon: FileSearch, description: 'Screenshots, traces and run artifacts.' },
  { name: 'Root Cause Analyzer', path: '/root-cause', icon: ShieldAlert, description: 'Failure classification and root cause.' },
  { name: 'Defect Intelligence', path: '/defects', icon: Bug, description: 'Defect tracking, severity and trends.' },
  { name: 'Regression Intelligence', path: '/regression', icon: History, description: 'Regression suite selection and history.' },
  { name: 'Release Quality Gate', path: '/releases', icon: CheckCircle, description: 'Go / no-go criteria per release.' },
  { name: 'Reports', path: '/reports', icon: BarChart, description: 'Execution and quality reports.' },
  { name: 'Integrations', path: '/integrations', icon: Network, description: 'Jira, CI and tool connections.' },
  { name: 'Settings', path: '/settings', icon: Settings, description: 'Organization, users and preferences.' },
];
