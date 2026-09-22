import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TeamMember } from '@/lib/directory';
import type { TrackerTask } from '@/lib/domain';
import type { TeamFile } from '@/lib/phase3-service';
import { canMoveKanbanTask, TaskDetails } from './KanbanBoard';

const directory = new Map<string, TeamMember>([
  ['uid-ada', { userId: 'uid-ada', role: 'student', status: 'active', displayName: 'Ada Lovelace', photoURL: null, initials: 'AL' }],
  ['uid-grace', { userId: 'uid-grace', role: 'coach', status: 'active', displayName: 'Grace Hopper', photoURL: null, initials: 'GH' }],
  ['uid-pat', { userId: 'uid-pat', role: 'parent', status: 'active', displayName: 'Pat Parent', photoURL: null, initials: 'PP' }]
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
  categoryId: null,
  labels: [],
  checklist: [],
  subtasks: [],
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
    expect(close).toHaveFocus();
    // Tab from whatever the dialog's last control currently is; the trap has to
    // wrap to the first one, and the section list below the form changes over
    // time (subtasks, attachments).
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    focusable.at(-1)!.focus();
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

describe('TaskDetails for a student editor', () => {
  it('lets a student edit card details but keeps file attaching coach-only', () => {
    const onSave = vi.fn();
    render(<TaskDetails task={task} canManage={false} canEdit busy={false} attachableFiles={[teamFile()]} onAttachFile={vi.fn()} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Test robot twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test robot twice' }), 1);
    expect(screen.getByRole('button', { name: 'Add subtask' })).toBeInTheDocument();
    expect(screen.queryByText('Attach a team file')).not.toBeInTheDocument();
  });

  it('shows a read-only card when the role cannot edit', () => {
    render(<TaskDetails task={task} canManage={false} canEdit={false} busy={false} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save task' })).not.toBeInTheDocument();
    expect(screen.getByText('Check every mission.')).toBeInTheDocument();
  });
});

describe('Kanban task movement permissions', () => {
  it('lets coaches, team leaders and students move any card; mentors and parents none', () => {
    expect(canMoveKanbanTask('coach')).toBe(true);
    expect(canMoveKanbanTask('teamLeader')).toBe(true);
    // Students move any card now, not only their own.
    expect(canMoveKanbanTask('student')).toBe(true);
    expect(canMoveKanbanTask('mentor')).toBe(false);
    expect(canMoveKanbanTask('parent')).toBe(false);
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

  it('offers only the people it is given — the board leaves parents out', () => {
    render(<TaskDetails task={task} canManage busy={false} directory={directory} people={['uid-ada', 'uid-grace']} onClose={vi.fn()} onSave={vi.fn()} />);
    const assignee = screen.getByRole('combobox', { name: 'Assignee' });
    const names = Array.from(assignee.querySelectorAll('option')).map((option) => option.textContent);
    expect(names).toContain('Ada Lovelace');
    expect(names).not.toContain('Pat Parent');
  });

  it('keeps a card already assigned to a parent showing who has it', () => {
    render(<TaskDetails task={{ ...task, assignedTo: 'uid-pat' }} canManage busy={false} directory={directory} people={['uid-ada', 'uid-grace']} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveValue('uid-pat');
  });

  it('gives no subtask tick when the board withholds it from a parent', () => {
    const withSubtask = { ...task, assignedTo: 'uid-pat', subtasks: [{ id: 'sub-1', title: 'Pack the robot', status: 'todo' as const, assignedTo: 'uid-pat', dueAt: null }] };
    render(<TaskDetails task={withSubtask} canManage={false} busy={false} directory={directory} actorUserId="uid-pat" onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText('Pack the robot')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /pack the robot/i })).not.toBeInTheDocument();
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

describe('TaskDetails file upload', () => {
  it('lets a coach upload a file straight onto the card when team files are on', () => {
    const onUploadFile = vi.fn();
    render(<TaskDetails task={task} canManage busy={false} fileSharing="teamOnly" onUploadFile={onUploadFile} onClose={vi.fn()} onSave={vi.fn()} />);
    const file = new File(['%PDF-1.4'], 'rubric.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Upload a file'), { target: { files: [file] } });
    expect(onUploadFile).toHaveBeenCalledWith(file);
    expect(screen.getByText(/up to 10 MB/)).toBeInTheDocument();
  });

  it('shows upload progress and any error', () => {
    render(<TaskDetails task={task} canManage busy={false} fileSharing="teamOnly" onUploadFile={vi.fn()} uploadProgress={0.42} uploadError="rubric.pdf is larger than 10 MB." onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText('Uploading… 42%')).toBeInTheDocument();
    expect(screen.getByLabelText('Upload a file')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 10 MB');
  });

  it('tells a coach how to turn team files on', () => {
    render(<TaskDetails task={task} canManage busy={false} fileSharing="disabled" onUploadFile={vi.fn()} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText(/Team files are turned off/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Upload a file')).not.toBeInTheDocument();
  });

  it('offers no upload to a student', () => {
    render(<TaskDetails task={task} canManage={false} canEdit busy={false} fileSharing="teamOnly" onUploadFile={vi.fn()} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByLabelText('Upload a file')).not.toBeInTheDocument();
  });
});
