import type { NavItem } from '@/config/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Placeholder for modules not built yet. */
export default function ModulePage({ item }: { item: NavItem }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <item.icon className="h-6 w-6 text-accent-cyan" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
        <Badge variant="secondary">Coming soon</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{item.name}</CardTitle>
          <CardDescription>{item.description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
