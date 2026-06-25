export type XrayBucketIndex = 0 | 1 | 2 | 3 | 4;

export interface XrayBucket {
  label: string;
  visible: boolean;
  color: string;
}

export interface XraySettings {
  enabled: boolean;
  buckets: XrayBucket[];
}

export const DEFAULT_XRAY_SETTINGS: XraySettings = {
  enabled: false,
  buckets: [
    { label: '1-2k', visible: true, color: '#2f6f4e' },
    { label: '3-5k', visible: true, color: '#7b5f13' },
    { label: '6-9k', visible: true, color: '#a34b16' },
    { label: '10k+', visible: true, color: '#9f2f45' },
    { label: 'OOV', visible: true, color: '#6b3fa0' },
  ],
};

export function bucketOf(band: number | null | undefined): XrayBucketIndex {
  if (band == null) return 4;
  if (band <= 2) return 0;
  if (band <= 5) return 1;
  if (band <= 9) return 2;
  return 3;
}

export function normalizeXraySettings(value?: Partial<XraySettings> | null): XraySettings {
  const buckets = DEFAULT_XRAY_SETTINGS.buckets.map((bucket, index) => ({
    ...bucket,
    ...(value?.buckets?.[index] ?? {}),
    label: bucket.label,
  }));
  return {
    enabled: value?.enabled ?? DEFAULT_XRAY_SETTINGS.enabled,
    buckets,
  };
}
