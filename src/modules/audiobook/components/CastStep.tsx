import { useState } from 'react';
import { Mic2, UserCircle2, Check } from 'lucide-react';
import type { AudiobookProject, AudiobookProjectUpdate, Speaker } from '../types';
import { MODEL_OPTIONS, ROLE_LABELS, rolesForMode } from '../types';
import VoicePicker from './VoicePicker';

// Step 2 — assign an ElevenLabs voice to each role the narration mode needs, plus
// the synthesis model. In duet mode there are two voices and you choose which one
// reads the narration.
export default function CastStep({
  project, onChange,
}: {
  project: AudiobookProject;
  onChange: (patch: AudiobookProjectUpdate) => void;
}) {
  const [picking, setPicking] = useState<Speaker | null>(null);
  const roles = rolesForMode(project.narration_mode);

  function voiceFor(role: Speaker): { id: string | null; name: string | null } {
    if (role === 'male') return { id: project.male_voice_id, name: project.male_voice_name };
    if (role === 'female') return { id: project.female_voice_id, name: project.female_voice_name };
    return { id: project.narrator_voice_id, name: project.narrator_voice_name };
  }

  function assign(role: Speaker, voiceId: string, name: string) {
    if (role === 'male') onChange({ male_voice_id: voiceId, male_voice_name: name });
    else if (role === 'female') onChange({ female_voice_id: voiceId, female_voice_name: name });
    else onChange({ narrator_voice_id: voiceId, narrator_voice_name: name });
    setPicking(null);
  }

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Voice model</label>
          <select value={project.model_id} onChange={e => onChange({ model_id: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <p className="text-xs text-slate-400 mt-1">{MODEL_OPTIONS.find(m => m.id === project.model_id)?.note}</p>
        </div>
        {project.narration_mode === 'duet' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Who narrates?</label>
            <select value={project.narrator_role} onChange={e => onChange({ narrator_role: e.target.value as 'male' | 'female' })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="female">The female voice</option>
              <option value="male">The male voice</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">In a two-voice duet, narration is read by one of the two.</p>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {roles.map(role => {
          const v = voiceFor(role);
          return (
            <div key={role} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
              <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${role === 'female' ? 'bg-pink-100 text-pink-600' : role === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                {role === 'narrator' ? <Mic2 className="w-4 h-4" /> : <UserCircle2 className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{ROLE_LABELS[role]}</p>
                {v.id ? (
                  <p className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" /> {v.name}</p>
                ) : (
                  <p className="text-xs text-slate-400">No voice assigned yet</p>
                )}
              </div>
              <button onClick={() => setPicking(role)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50">
                {v.id ? 'Change' : 'Assign'}
              </button>
            </div>
          );
        })}
      </div>

      {picking && (
        <VoicePicker
          roleLabel={ROLE_LABELS[picking]}
          onClose={() => setPicking(null)}
          onAssign={(id, name) => assign(picking, id, name)}
        />
      )}
    </div>
  );
}
