import type { Book } from '../../catalog/types';
import AddApplicantsPanel from './AddApplicantsPanel';

interface Props {
  userId: string;
  catalogBooks: Book[];
  onImported: () => void;
}

export default function ImportTab({ userId, catalogBooks, onImported }: Props) {
  return (
    <div className="space-y-4">
      <AddApplicantsPanel userId={userId} catalogBooks={catalogBooks} onImported={onImported} />
    </div>
  );
}
