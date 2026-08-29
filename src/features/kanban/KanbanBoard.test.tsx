import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TeamMember } from '@/lib/directory';
import type { TrackerTask } from '@/lib/domain';
import type { TeamFile } from '@/lib/phase3-service';
import { canMoveKanbanTask, TaskDetails } from './KanbanBoard';

const directory = new Map<string, TeamMember>([
  ['uid-ada', { userId: 'uid-ada', role: 'student', status: 'active', displayName: 'Ada Lovelace', photoURL: null, initials: 'AL' }],
  ['uid-grace', { userId: 'uid-grace', role: 'coach', status: 'active', displayName: 'Grace Hopper', photoURL: null, initials: 'GH' }]
]);

function teamFile(overrides: Partial<TeamFile> = {}): TeamFile {
  return {
    id: 'file-1',
    teamId: 'team-1',
    name: 'mission-plan.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    storagePath: 'teams/team-1/files/file-1/mission-plan.pdf',
    status: 'ready',
    uploadedBy: 'uid-grace',
    folderId: null,
    linkedTaskIds: [],
    downloadUrl: 'https://files.example/mission-plan.pdf',
    ...overrides
  };
}

const task: TrackerTask = {
  id: 'task-1',
  teamId: 'team-1',
  createdBy: 'coach-1',
  title: 'Test robot',
  description: 'Check every mission.',
  status: 'todo',
  priority: 'high',
  assignedTo: null,
  watcherUserIds: [],
  goalId: null,
  labels: [],
  checklist: [],
  attachmentFileIds: [],
  historyCount: 0
};

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Open task</button>{open ? <TaskDetails task={task} canManage busy={false} onClose={() => setOpen(false)} onSave={vi.fn()} /> : null}</>;
}

describe('TaskDetails native dialog accessibility', () => {
  it('traps forward focus and restores the opener after Escape', async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open task' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Test robot' });
    const close = screen.getByRole('button', { name: 'Close task details' });
    const save = screen.getByRole('button', { name: 'Save task' });
    expect(close).toHaveFocus();
    save.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves a dirty draft and requires an explicit reload after a remote version change', () => {
    const onSave = vi.fn();
    const { rerender } = render(<TaskDetails task={{ ...task, version: 1 }} canManage busy={false} onClose={vi.fn()} onSave={onSave} />);
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'My unsaved title' } });

    rerender(<TaskDetails task={{ ...task, title: 'Remote title', version: 2 }} canManage busy={false} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole('alert')).toHaveTextContent('draft is preserved');
    expect(title).toHaveValue('My unsaved title');
    expect(screen.getByRole('button', { name: 'Save task' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Load latest task' }));
    expect(title).toHaveValue('Remote title');
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remote title' }), 2);
  });
});

describe('Kanban task movement permissions', () => {
  it('allows administrators to move any card and Students only their own assignment', () => {
    expect(canMoveKanbanTask({ assignedTo: null }, 'coach', 'coach-1')).toBe(true);
    expect(canMoveKanbanTask({ assignedTo: 'student-2' }, 'teamLeader', 'leader-1')).toBe(true);
    expect(canMoveKanbanTask({ assignedTo: 'student-1' }, 'student', 'student-1')).toBe(true);
    expect(canMoveKanbanTask({ assignedTo: 'student-2' }, 'student', 'student-1')).toBe(false);
    expect(canMoveKanbanTask({ assignedTo: null }, 'student', 'student-1')).toBe(false);
    expect(canMoveKanbanTask({ assignedTo: 'mentor-1' }, 'mentor', 'mentor-1')).toBe(false);
    expect(canMoveKanbanTask({ assignedTo: 'parent-1' }, 'parent', 'parent-1')).toBe(false);
  });
});

describe('TaskDetails people and attachments', () => {
  it('assigns a teammate by name instead of asking for a Firebase UID', () => {
    const onSave = vi.fn();
    render(<TaskDetails task={{ ...task, version: 1 }} canManage busy={false} people={['uid-ada', 'uid-grace']} directory={directory} onClose={vi.fn()} onSave={onSave} />);
    const assignee = screen.getByLabelText('Assignee');
    expect(assignee.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();

    fireEvent.change(assignee, { target: { value: 'uid-grace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'uid-grace' }), 1);
  });

  it('names the assignee for a member who cannot edit the card', () => {
    render(<TaskDetails task={{ ...task, assignedTo: 'uid-ada' }} canManage={false} busy={false} directory={directory} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('lists the files attached to the card with a working download link', () => {
    render(<TaskDetails task={{ ...task, attachmentFileIds: ['file-1'] }} canManage busy={false} attachments={[teamFile()]} onClose={vi.fn()} onSave={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'mission-plan.pdf' });
    expect(link).toHaveAttribute('href', 'https://files.example/mission-plan.pdf');
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('offers a retry when the attachments could not be read', () => {
    const onReloadAttachments = vi.fn();
    render(<TaskDetails task={task} canManage busy={false} attachmentsStatus="error" onReloadAttachments={onReloadAttachments} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onReloadAttachments).toHaveBeenCalled();
  });

  it('links an existing team file onto the card', () => {
    const onAttachFile = vi.fn();
    render(<TaskDetails task={task} canManage busy={false} attachableFiles={[teamFile({ id: 'file-9', name: 'scores.csv' })]} onAttachFile={onAttachFile} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Attach a team file'), { target: { value: 'file-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onAttachFile).toHaveBeenCalledWith('file-9');
  });
});
