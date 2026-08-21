"use client";

import { useEffect, useState } from "react";
import { Coffee, LogOut, Wifi, WifiOff } from "lucide-react";

export default function PosNavbar({
  cashierName,
  onLogout,
}: {
  cashierName: string;
  onLogout: () => void;
}) {
  const [isOnline, setIsOnline] = useState(true);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(clock);
    };
  }, []);

  return (
    <header className="h-16 bg-white border-b border-neutral-200 flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <Coffee className="text-white" size={18} />
        </div>
        <span className="font-bold text-neutral-900 hidden sm:inline">caPOS</span>
        {isOnline ? (
          <span className="badge-active">
            <Wifi size={12} /> Online
          </span>
        ) : (
          <span className="badge-urgent">
            <WifiOff size={12} /> Offline
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-sm font-mono text-neutral-500 hidden sm:inline">
          {now.toLocaleTimeString("id-ID")}
        </span>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary-light text-primary-dark flex items-center justify-center text-xs font-bold">
            {cashierName.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-neutral-700 hidden md:inline">{cashierName}</span>
        </div>
        <button onClick={onLogout} className="text-neutral-400 hover:text-urgent transition-colors" title="Logout">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
