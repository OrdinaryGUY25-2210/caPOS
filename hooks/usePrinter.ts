/**
 * usePrinter Hook — Printer Connection & Printing Logic
 * Supports Bluetooth (Web Bluetooth), USB (WebUSB), Network (fetch to print server)
 * Manages connection lifecycle, retry, and fallback
 */

'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import {
  PrinterConfig,
  ConnectionType,
  PrintJob,
  DEFAULT_BLUETOOTH_UUIDS,
  buildTestPrint,
} from '@/lib/printer';
import {
  buildCustomerReceipt,
  buildKitchenTicket,
  TransactionData,
} from '@/lib/print-templates';

export interface PrinterState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  config?: PrinterConfig;
  isPrinting: boolean;
}

export interface UsePrinterReturn {
  state: PrinterState;
  /** Connect to printer based on config */
  connect: (config: PrinterConfig) => Promise<boolean>;
  /** Disconnect current printer */
  disconnect: () => Promise<void>;
  /** Print customer receipt */
  printReceipt: (tx: TransactionData, config?: PrinterConfig) => Promise<boolean>;
  /** Print kitchen ticket */
  printKitchen: (tx: TransactionData, config?: PrinterConfig) => Promise<boolean>;
  /** Print both: kitchen first, then receipt */
  printBoth: (tx: TransactionData, config?: PrinterConfig) => Promise<{ kitchen: boolean; receipt: boolean }>;
  /** Print test page */
  printTest: (config?: PrinterConfig) => Promise<boolean>;
  /** Request Bluetooth device picker (for settings UI) */
  requestBluetoothDevice: (serviceUuid?: string) => Promise<{ deviceId: string; name: string } | null>;
  /** Check if browser supports required APIs */
  capabilities: {
    bluetooth: boolean;
    usb: boolean;
    network: boolean;
  };
}

interface BluetoothConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
}

interface USBConnection {
  device: USBDevice;
  endpointOut: number;
}

type ActiveConnection = BluetoothConnection | USBConnection | null;

/** Check browser capabilities */
function getCapabilities() {
  if (typeof window === 'undefined') {
    return { bluetooth: false, usb: false, network: true };
  }
  return {
    bluetooth: 'bluetooth' in navigator,
    usb: 'usb' in navigator,
    network: true,
  };
}

/** Delay helper */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Write to Bluetooth characteristic with chunking */
async function writeBluetooth(char: BluetoothRemoteGATTCharacteristic, data: Uint8Array): Promise<void> {
  const MTU = 180; // Conservative BLE MTU
  for (let i = 0; i < data.length; i += MTU) {
    await char.writeValue(data.slice(i, i + MTU));
    await delay(10); // Small delay between chunks
  }
}

/** Write to USB endpoint */
async function writeUSB(device: USBDevice, endpointOut: number, data: Uint8Array): Promise<void> {
  const result = await device.transferOut(endpointOut, data);
  if (result.status !== 'ok') {
    throw new Error(`USB transfer failed: ${result.status}`);
  }
}

/** Send via network print server */
async function sendNetwork(url: string, data: Uint8Array, headers?: Record<string, string>): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...headers,
    },
    body: data,
  });
  if (!response.ok) {
    throw new Error(`Network print failed: ${response.status} ${response.statusText}`);
  }
}

export function usePrinter(): UsePrinterReturn {
  const [state, setState] = useState<PrinterState>({
    status: 'disconnected',
    isPrinting: false,
  });
  const connectionRef = useRef<ActiveConnection>(null);
  const configRef = useRef<PrinterConfig | null>(null);
  const capabilities = getCapabilities();

  /** Update state helper */
  const setStatus = useCallback((status: PrinterState['status'], error?: string) => {
    setState(prev => ({ ...prev, status, error }));
  }, []);

  /** Connect based on config.connection */
  const connect = useCallback(async (config: PrinterConfig): Promise<boolean> => {
    setStatus('connecting');
    configRef.current = config;

    try {
      let connection: ActiveConnection = null;

      switch (config.connection) {
        case 'bluetooth': {
          if (!capabilities.bluetooth) throw new Error('Web Bluetooth tidak didukung browser ini');
          
          let device: BluetoothDevice;
          if (config.bluetoothDeviceId) {
            // Reconnect to previously paired device
            device = await navigator.bluetooth.getDevice(config.bluetoothDeviceId);
          } else {
            throw new Error('Belum ada perangkat Bluetooth terpilih. Pilih di pengaturan.');
          }

          const server = await device.gatt!.connect();
          const serviceUuid = config.bluetoothServiceUuid || DEFAULT_BLUETOOTH_UUIDS.service;
          const charUuid = config.bluetoothCharUuid || DEFAULT_BLUETOOTH_UUIDS.characteristic;
          const service = await server.getPrimaryService(serviceUuid);
          const characteristic = await service.getCharacteristic(charUuid);

          connection = { device, characteristic };
          break;
        }

        case 'usb': {
          if (!capabilities.usb) throw new Error('WebUSB tidak didukung browser ini');
          
          const device = await navigator.usb.requestDevice({
            filters: config.usbVendorId ? [{ vendorId: config.usbVendorId }] : [],
          });
          await device.open();
          if (config.usbInterfaceNumber !== undefined) {
            await device.selectConfiguration(1);
            await device.claimInterface(config.usbInterfaceNumber);
          }
          const endpointOut = config.usbEndpointOut ?? 1;
          connection = { device, endpointOut };
          break;
        }

        case 'network': {
          if (!config.networkUrl) throw new Error('URL print server tidak dikonfigurasi');
          // Network doesn't maintain persistent connection
          connection = null; // stateless
          break;
        }
      }

      connectionRef.current = connection;
      setStatus('connected');
      setState(prev => ({ ...prev, config }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Koneksi gagal';
      setStatus('error', message);
      return false;
    }
  }, [capabilities, setStatus]);

  /** Disconnect */
  const disconnect = useCallback(async (): Promise<void> => {
    const conn = connectionRef.current;
    const cfg = configRef.current;

    if (!conn || !cfg) return;

    try {
      if (cfg.connection === 'bluetooth' && 'device' in conn) {
        await conn.device.gatt?.disconnect();
      } else if (cfg.connection === 'usb' && 'device' in conn) {
        await conn.device.close();
      }
    } catch {
      // Ignore disconnect errors
    } finally {
      connectionRef.current = null;
      setStatus('disconnected');
      setState(prev => ({ ...prev, config: undefined }));
    }
  }, [setStatus]);

  /** Generic print function */
  const print = useCallback(async (
    data: Uint8Array,
    config: PrinterConfig
  ): Promise<boolean> => {
    setState(prev => ({ ...prev, isPrinting: true }));

    try {
      switch (config.connection) {
        case 'bluetooth': {
          const conn = connectionRef.current;
          if (!conn || !('characteristic' in conn)) {
            // Try to reconnect
            const connected = await connect(config);
            if (!connected) throw new Error('Tidak terhubung ke printer Bluetooth');
          }
          const char = (connectionRef.current as BluetoothConnection).characteristic;
          await writeBluetooth(char, data);
          break;
        }

        case 'usb': {
          const conn = connectionRef.current;
          if (!conn || !('device' in conn)) {
            const connected = await connect(config);
            if (!connected) throw new Error('Tidak terhubung ke printer USB');
          }
          const { device, endpointOut } = connectionRef.current as USBConnection;
          await writeUSB(device, endpointOut, data);
          break;
        }

        case 'network': {
          if (!config.networkUrl) throw new Error('URL print server tidak dikonfigurasi');
          await sendNetwork(config.networkUrl, data, config.networkHeaders);
          break;
        }
      }

      // Small delay for cutter/mechanism
      await delay(300);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cetak gagal';
      setStatus('error', message);
      return false;
    } finally {
      setState(prev => ({ ...prev, isPrinting: false }));
    }
  }, [connect, setStatus]);

  /** Print customer receipt */
  const printReceipt = useCallback(async (
    tx: TransactionData,
    config?: PrinterConfig
  ): Promise<boolean> => {
    const cfg = config || configRef.current;
    if (!cfg) return false;

    const data = buildCustomerReceipt(tx, cfg);
    return print(data, cfg);
  }, [print]);

  /** Print kitchen ticket */
  const printKitchen = useCallback(async (
    tx: TransactionData,
    config?: PrinterConfig
  ): Promise<boolean> => {
    const cfg = config || configRef.current;
    if (!cfg) return false;

    const data = buildKitchenTicket(tx, cfg);
    return print(data, cfg);
  }, [print]);

  /** Print both: kitchen first, then receipt */
  const printBoth = useCallback(async (
    tx: TransactionData,
    config?: PrinterConfig
  ): Promise<{ kitchen: boolean; receipt: boolean }> => {
    const cfg = config || configRef.current;
    if (!cfg) return { kitchen: false, receipt: false };

    const kitchenOk = await printKitchen(tx, cfg);
    // Delay between prints for cutter/mechanism
    await delay(500);
    const receiptOk = await printReceipt(tx, cfg);

    return { kitchen: kitchenOk, receipt: receiptOk };
  }, [printKitchen, printReceipt]);

  /** Print test page */
  const printTest = useCallback(async (config?: PrinterConfig): Promise<boolean> => {
    const cfg = config || configRef.current;
    if (!cfg) return false;

    const data = buildTestPrint(cfg);
    return print(data, cfg);
  }, [print]);

  /** Request Bluetooth device picker (for settings) */
  const requestBluetoothDevice = useCallback(async (
    serviceUuid?: string
  ): Promise<{ deviceId: string; name: string } | null> => {
    if (!capabilities.bluetooth) return null;

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [serviceUuid || DEFAULT_BLUETOOTH_UUIDS.service] }],
        optionalServices: [serviceUuid || DEFAULT_BLUETOOTH_UUIDS.service],
      });
      return { deviceId: device.id, name: device.name || 'Unknown Device' };
    } catch {
      return null;
    }
  }, [capabilities.bluetooth]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current && configRef.current) {
        disconnect();
      }
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    printReceipt,
    printKitchen,
    printBoth,
    printTest,
    requestBluetoothDevice,
    capabilities,
  };
}

export type { PrinterState, UsePrinterReturn };