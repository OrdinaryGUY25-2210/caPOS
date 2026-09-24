'use client';

import Link from 'next/link';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * PRIORITY 11 audit finding: this page used to show a hardcoded fake plan
 * ("Paket Premium — Rp. 299.000/bulan") regardless of the tenant's real
 * subscription row. That's actively misleading — it could contradict the
 * REAL, fully wired subscription page at app/dashboard/subscription/page.tsx
 * (getCurrentProfile + subscriptions table + v_subscription_quota).
 *
 * Rather than duplicate that page's Supabase logic here (risk of the two
 * ever disagreeing again), this settings entry now just points to the
 * single source of truth.
 */
export default function SubscriptionSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader title="Pengaturan Langganan" description="Kelola paket langganan Anda" />

      <Card className="p-6 text-center space-y-3">
        <p className="text-gray-700">
          Detail paket, kuota, dan upgrade/downgrade langganan dikelola di halaman Langganan.
        </p>
        <Link href="/dashboard/subscription">
          <Button variant="primary">Buka Halaman Langganan</Button>
        </Link>
      </Card>
    </div>
  );
}
