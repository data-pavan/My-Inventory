export type TransactionType = 'IN' | 'OUT' | 'SCHEDULED' | 'FACTORY_IN';

export interface Category {
  id: string;
  name: string;
  description?: string;
}

export interface Item {
  id: string;
  name: string;
  categoryId: string;
  unit: string;
  minStock: number;
  initialStock: number;
  currentStock: number;
  scheduledStock: number;
  isStockable?: boolean;
}

export interface Transaction {
  id: string;
  voucherNo: string;
  invoiceNo?: string;
  salesPerson?: string;
  date: string;
  type: TransactionType;
  itemId: string;
  quantity: number;
  sourceDestination?: string;
  location?: string;
  createdBy: string;
  creatorEmail: string;
  creatorRole: string;
  totalBoxes?: number;
  fromScheduled?: boolean;
  production?: number;
  rejected?: number;
  shift?: string;
  lrNo?: string;
  deliveryPartner?: string;
  customDeliveryPartner?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'staff';
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}
