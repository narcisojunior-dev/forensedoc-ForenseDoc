import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Landing from '../pages/Landing.jsx';
import { MemoryRouter } from 'react-router-dom';

describe('Landing Page', () => {
  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );
    // Forçando o teste a falhar para ver o RED
    expect(screen.queryByText('ForenseDoc')).not.toBeInTheDocument();
  });
});
