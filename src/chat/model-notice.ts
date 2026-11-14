// The notice for "the model you set does not exist at this provider, this answer used another one".
// The router (src/chat/providers.ts) repeats the request itself; here the user can keep the stand-in as the setting.

import { api } from '../app/backend.js';
import { notify, notifyError, toast } from '../app/notifications.js';
import { t } from '../app/i18n.js';
import { bus } from '../app/bus.js';
import { aiConfig } from './config.js';
import type { StreamEvent } from './types.js';

type ModelNotice = Extract<StreamEvent, { type: 'notice' }>;

/** Saves `to` as the model of the provider (presets and own endpoints use different routes). */
export async function useModel(providerId: string, to: string): Promise<void> {
  if (providerId.startsWith('custom-')) await api.send('PUT', `/api/config/custom/${providerId}`, { model: to });
  else await api.send('PUT', '/api/config/provider', { id: providerId, model: to });
  await aiConfig.get();
  await aiConfig.changed();
  bus.emit('ai:status');
}

export function showModelNotice(ev: ModelNotice): void {
  const fix = ev.fix;
  notify({
    level: 'warning',
    title: t('Model not found, another one answered'),
    message: fix ? t('{from} does not exist at this provider. This answer used {to}. Keep {to} as the model of this provider?', { from: fix.from, to: fix.to }) : ev.message,
    actions: fix
      ? [
          {
            label: t('Keep {to}', { to: fix.to }),
            primary: true,
            run: async () => {
              try {
                await useModel(fix.providerId, fix.to);
                toast(t('Model set to {to}', { to: fix.to }), 'success');
              } catch (e) {
                notifyError(e);
              }
            },
          },
          { label: t('Choose another'), run: () => bus.emit('open-settings', 'ai') },
        ]
      : [],
    timeout: 20000,
  });
}
