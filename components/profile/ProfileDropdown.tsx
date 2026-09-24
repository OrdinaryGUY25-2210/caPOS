'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { LogOut, Settings, User } from 'lucide-react';
import { DeleteAccountModal } from './DeleteAccountModal';

export function ProfileDropdown() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const handleLogout = () => {
    // TODO: Implement logout logic
  };

  const handleDeleteAccount = () => {
    // TODO: Implement account deletion
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100"
        >
          <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
            A
          </div>
          <div className="hidden md:block text-left flex-1">
            <p className="text-sm font-medium text-gray-900">Admin</p>
            <p className="text-xs text-gray-600">admin@capos.com</p>
          </div>
        </button>

        {dropdownOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
            <Link
              href="/dashboard/settings/profile"
              className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 text-gray-700 border-b"
            >
              <User size={18} />
              Profil
            </Link>
            <Link
              href="/dashboard/settings"
              className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 text-gray-700 border-b"
            >
              <Settings size={18} />
              Pengaturan
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 text-gray-700 w-full text-left border-b"
            >
              <LogOut size={18} />
              Logout
            </button>
            <button
              onClick={() => setDeleteModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 hover:bg-red-50 text-red-600 w-full text-left"
            >
              🗑️ Hapus Akun
            </button>
          </div>
        )}
      </div>

      <DeleteAccountModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        businessName="Bisnis Saya"
        onConfirm={handleDeleteAccount}
      />
    </>
  );
}
