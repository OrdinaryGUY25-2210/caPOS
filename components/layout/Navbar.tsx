import React from 'react';
import { Bell, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';

export function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <div className="flex-1 max-w-xs">
        <Input
          type="search"
          placeholder="Search..."
          className="w-full"
        />
      </div>
      <div className="flex items-center gap-4">
        <button className="p-2 hover:bg-gray-100 rounded-lg">
          <Bell size={20} className="text-gray-600" />
        </button>
      </div>
    </nav>
  );
}
