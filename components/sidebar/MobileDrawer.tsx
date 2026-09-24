import React from 'react';
import { X } from 'lucide-react';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function MobileDrawer({ open, onClose, children }: MobileDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="fixed left-0 top-0 h-full w-64 bg-white shadow-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-bold">caPOS</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={24} />
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-80px)]">
          {children}
        </div>
      </div>
    </div>
  );
}
