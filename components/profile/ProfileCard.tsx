import React from 'react';
import { Card } from '@/components/ui/Card';

export function ProfileCard() {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-2xl font-bold">
          A
        </div>
        <div>
          <h3 className="font-semibold">Admin</h3>
          <p className="text-sm text-gray-600">admin@capos.com</p>
        </div>
      </div>
    </Card>
  );
}
