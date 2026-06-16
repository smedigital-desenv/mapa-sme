/**
 * ============================================================
 * CHARTS.JS - Gráficos com Chart.js
 * ============================================================
 * Renderiza gráficos de barras para os resumos de disciplinas.
 */

const Charts = (() => {
  let chartDisciplinas = null;

  // Renderizar gráfico de disciplinas
  function renderizarDisciplinas(dados) {
    const canvas = document.getElementById('chartDisciplinas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Destruir instância anterior (evita sobreposição)
    if (chartDisciplinas) {
      chartDisciplinas.destroy();
      chartDisciplinas = null;
    }

    if (!dados || dados.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const labels = dados.map(d => Format.truncar(d.fnc_disciplina, 22));
    const valores = dados.map(d => parseFloat(d.percentual_sucesso) || 0);
    const cores = valores.map(p => p >= 90 ? '#28a745' : p >= 75 ? '#ffc107' : '#dc3545');

    chartDisciplinas = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '% de Sucesso',
          data: valores,
          backgroundColor: cores,
          borderColor: cores,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${Format.percentual(ctx.parsed.y)}`
            }
          },
          datalabels: {
            anchor: 'end',
            align: 'top',
            color: '#333',
            font: { weight: 'bold', size: 10 },
            formatter: (v) => v.toFixed(0) + '%'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { callback: (v) => v + '%' }
          },
          x: {
            ticks: { maxRotation: 45, minRotation: 0, font: { size: 10 } }
          }
        }
      },
      plugins: [ChartDataLabels]
    });
  }

  function destroy() {
    if (chartDisciplinas) {
      chartDisciplinas.destroy();
      chartDisciplinas = null;
    }
  }

  return { renderizarDisciplinas, destroy };
})();

window.Charts = Charts;
