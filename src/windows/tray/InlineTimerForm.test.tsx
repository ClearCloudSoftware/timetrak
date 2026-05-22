import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineTimerForm } from './InlineTimerForm';
import type { Category, Project } from '../../types';

const cats: Category[] = [
  { id: 'c1', name: 'Coding', color: '#10b981' },
  { id: 'c2', name: 'Meeting', color: '#3b82f6' },
];
const projs: Project[] = [{ id: 'p1', name: 'ACME', color: '#3b82f6' }];

describe('InlineTimerForm', () => {
  it('disables Start when no category is selected', () => {
    render(
      <InlineTimerForm
        initial={{ categoryId: null, projectId: null, description: '' }}
        categories={cats}
        projects={projs}
        onCancel={() => {}}
        onSubmit={() => {}}
        submitting={false}
      />
    );
    const start = screen.getByRole('button', { name: /start/i }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('fires onSubmit with normalized values when Start is clicked', () => {
    const onSubmit = vi.fn();
    render(
      <InlineTimerForm
        initial={{ categoryId: 'c1', projectId: 'p1', description: '   hello   ' }}
        categories={cats}
        projects={projs}
        onCancel={() => {}}
        onSubmit={onSubmit}
        submitting={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(onSubmit).toHaveBeenCalledWith({ categoryId: 'c1', projectId: 'p1', description: 'hello' });
  });

  it('passes null description when input is whitespace', () => {
    const onSubmit = vi.fn();
    render(
      <InlineTimerForm
        initial={{ categoryId: 'c1', projectId: null, description: '   ' }}
        categories={cats}
        projects={projs}
        onCancel={() => {}}
        onSubmit={onSubmit}
        submitting={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(onSubmit).toHaveBeenCalledWith({ categoryId: 'c1', projectId: null, description: null });
  });

  it('fires onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <InlineTimerForm
        initial={{ categoryId: 'c1', projectId: null, description: '' }}
        categories={cats}
        projects={projs}
        onCancel={onCancel}
        onSubmit={() => {}}
        submitting={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
