export type UserRole = "super_admin" | "owner" | "cashier";
export type SubStatus = "trial" | "active" | "past_due" | "expired";

export interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  has_custom_website: boolean;
  custom_website_url: string | null;
  show_wifi_on_receipt: boolean;
  wifi_ssid: string | null;
  wifi_password: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  status: SubStatus;
  trial_ends_at: string;
  valid_until: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  tenant_id: string;
  role: UserRole;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

export interface InviteCode {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  price: number;
  category: string;
  image_url: string | null;
  is_available: boolean;
  created_at: string;
}

export interface Membership {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_phone: string;
  member_code: string;
  discount_percentage: number;
  valid_until: string;
  is_active: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  tenant_id: string;
  cashier_id: string;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  member_id: string | null;
  is_offline_sync: boolean;
  created_at: string;
}

export interface TransactionItem {
  id: string;
  transaction_id: string;
  product_id: string;
  qty: number;
  subtotal: number;
}

export interface CartItem extends Product {
  qty: number;
}
