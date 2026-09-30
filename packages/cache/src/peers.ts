export interface PeerPicker {
  pickPeer(key: string): [Peer | null, boolean, boolean];
  close(): Promise<void>;
}

export interface Peer {
  get(group: string, key: string): Promise<Buffer>;
  set(group: string, key: string, value: Buffer): Promise<void>;
  delete(group: string, key: string): Promise<boolean>;
  close(): Promise<void>;
}
