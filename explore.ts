// explore.ts - SQLite Explorer Middleware
// Add this middleware to your Durable Object to explore the SQLite database

/**
 * Middleware to explore SQLite database tables with a simple UI
 * Handles requests to /:name/sqlite endpoints
 */
export async function explore(
  request: Request,
  sql: SqlStorage,
): Promise<Response | null> {
  const url = new URL(request.url);

  // Check if the request is for the SQLite explorer
  if (!url.pathname.endsWith("/sqlite")) {
    return null; // Not for this middleware, continue with normal request handling
  }

  // Parse query parameters
  const table = url.searchParams.get("table") || "";
  const sortColumn = url.searchParams.get("sort") || "";
  const sortDirection = url.searchParams.get("dir") || "asc";
  const filterColumn = url.searchParams.get("filter_column") || "";
  const filterValue = url.searchParams.get("filter_value") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("page_size") || "50", 10);

  try {
    // If no table is selected, list all tables
    if (!table) {
      return renderTableList(sql);
    }

    // Display table data with sorting and filtering
    return renderTableData(sql, table, {
      sortColumn,
      sortDirection,
      filterColumn,
      filterValue,
      page,
      pageSize,
    });
  } catch (error) {
    return new Response(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      {
        status: 500,
        headers: { "Content-Type": "text/html" },
      },
    );
  }
}

/**
 * Render a list of all tables in the database
 */
async function renderTableList(sql: SqlStorage): Promise<Response> {
  // Query for all tables
  const tables = sql
    .exec(
      `
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    ORDER BY name
  `,
    )
    .toArray();

  // Render HTML
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>SQLite Explorer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
          }
          h1, h2 {
            color: #2c3e50;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
          }
          th, td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid #ddd;
          }
          th {
            background-color: #f8f9fa;
          }
          tr:hover {
            background-color: #f1f1f1;
          }
          a {
            color: #3498db;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
          .card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 20px;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>SQLite Explorer</h1>
          <h2>Database Tables</h2>
          ${
            tables.length === 0 ? "<p>No tables found in the database.</p>" : ""
          }
          <table>
            <thead>
              <tr>
                <th>Table Name</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tables
                .map(
                  (table) => `
                <tr>
                  <td>${table.name}</td>
                  <td><a href="?table=${table.name}">View Data</a></td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}

interface TableRenderOptions {
  sortColumn: string;
  sortDirection: string;
  filterColumn: string;
  filterValue: string;
  page: number;
  pageSize: number;
}

/**
 * Render the table data with sorting and filtering
 */
async function renderTableData(
  sql: SqlStorage,
  tableName: string,
  options: TableRenderOptions,
): Promise<Response> {
  const {
    sortColumn,
    sortDirection,
    filterColumn,
    filterValue,
    page,
    pageSize,
  } = options;

  try {
    // Get table schema
    const tableInfo = sql.exec(`PRAGMA table_info(${tableName})`).toArray();

    if (tableInfo.length === 0) {
      return new Response(`Table '${tableName}' not found`, {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    }

    // Build query with optional filtering and sorting
    let query = `SELECT * FROM ${tableName}`;
    const params: any[] = [];

    // Add filtering if specified
    if (
      filterColumn &&
      filterValue &&
      tableInfo.some((col) => col.name === filterColumn)
    ) {
      query += ` WHERE ${filterColumn} LIKE ?`;
      params.push(`%${filterValue}%`);
    }

    // Add sorting if specified
    if (sortColumn && tableInfo.some((col) => col.name === sortColumn)) {
      query += ` ORDER BY ${sortColumn} ${
        sortDirection === "desc" ? "DESC" : "ASC"
      }`;
    }

    // Count total rows (for pagination)
    const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as count");
    const countResult = sql.exec(countQuery, ...params).one();
    const totalRows = countResult ? countResult.count : 0;
    const totalPages = Math.ceil(totalRows / pageSize);

    // Add pagination
    query += ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

    // Execute the query
    const rows = sql.exec(query, ...params).toArray();

    // Generate sorting links for each column
    function getSortLink(column: string) {
      const newDirection =
        sortColumn === column && sortDirection === "asc" ? "desc" : "asc";
      const params = new URLSearchParams({
        table: tableName,
        sort: column,
        dir: newDirection,
      });

      if (filterColumn) params.set("filter_column", filterColumn);
      if (filterValue) params.set("filter_value", filterValue);

      return `?${params.toString()}`;
    }

    // Generate pagination links
    function getPaginationLink(newPage: number) {
      const params = new URLSearchParams({
        table: tableName,
        page: newPage.toString(),
        page_size: pageSize.toString(),
      });

      if (sortColumn) params.set("sort", sortColumn);
      if (sortDirection) params.set("dir", sortDirection);
      if (filterColumn) params.set("filter_column", filterColumn);
      if (filterValue) params.set("filter_value", filterValue);

      return `?${params.toString()}`;
    }

    // Render HTML
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Table: ${tableName} - SQLite Explorer</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 1200px;
              margin: 0 auto;
              padding: 20px;
            }
            h1, h2 {
              color: #2c3e50;
            }
            table {
              border-collapse: collapse;
              width: 100%;
              margin: 20px 0;
              table-layout: auto;
              overflow-x: auto;
              display: block;
            }
            th, td {
              text-align: left;
              padding: 12px;
              border-bottom: 1px solid #ddd;
              max-width: 300px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            th {
              background-color: #f8f9fa;
              position: sticky;
              top: 0;
              z-index: 10;
            }
            tr:hover {
              background-color: #f1f1f1;
            }
            a {
              color: #3498db;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
            .sort-arrow {
              display: inline-block;
              width: 0;
              height: 0;
              margin-left: 5px;
              vertical-align: middle;
            }
            .sort-arrow.asc {
              border-left: 5px solid transparent;
              border-right: 5px solid transparent;
              border-bottom: 5px solid #333;
            }
            .sort-arrow.desc {
              border-left: 5px solid transparent;
              border-right: 5px solid transparent;
              border-top: 5px solid #333;
            }
            .filter-form {
              margin: 20px 0;
              display: flex;
              gap: 10px;
              align-items: end;
            }
            .form-group {
              display: flex;
              flex-direction: column;
              gap: 5px;
            }
            select, input, button {
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 4px;
              font-size: 14px;
            }
            button {
              background-color: #3498db;
              color: white;
              border: none;
              cursor: pointer;
            }
            button:hover {
              background-color: #2980b9;
            }
            .pagination {
              display: flex;
              gap: 10px;
              margin: 20px 0;
              align-items: center;
            }
            .pagination a, .pagination span {
              padding: 8px 12px;
              border: 1px solid #ddd;
              border-radius: 4px;
            }
            .pagination .current {
              background-color: #3498db;
              color: white;
              border-color: #3498db;
            }
            .card {
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
              padding: 20px;
              margin-bottom: 20px;
            }
            .empty-message {
              text-align: center;
              padding: 20px;
              color: #7f8c8d;
            }
            .back-link {
              margin-bottom: 20px;
              display: inline-block;
            }
          </style>
        </head>
        <body>
          <a href="?table=" class="back-link">&larr; Back to Tables</a>
          
          <div class="card">
            <h1>Table: ${tableName}</h1>
            
            <form class="filter-form" method="get">
              <input type="hidden" name="table" value="${tableName}">
              
              <div class="form-group">
                <label for="filter_column">Filter Column</label>
                <select id="filter_column" name="filter_column">
                  <option value="">-- Select Column --</option>
                  ${tableInfo
                    .map(
                      (col) => `
                    <option value="${col.name}" ${
                        filterColumn === col.name ? "selected" : ""
                      }>
                      ${col.name}
                    </option>
                  `,
                    )
                    .join("")}
                </select>
              </div>
              
              <div class="form-group">
                <label for="filter_value">Filter Value</label>
                <input type="text" id="filter_value" name="filter_value" value="${filterValue}">
              </div>
              
              <div class="form-group">
                <button type="submit">Apply Filter</button>
              </div>
              
              ${
                filterColumn && filterValue
                  ? `
                <div class="form-group">
                  <a href="?table=${tableName}${
                      sortColumn
                        ? `&sort=${sortColumn}&dir=${sortDirection}`
                        : ""
                    }">
                    Clear Filter
                  </a>
                </div>
              `
                  : ""
              }
            </form>
            
            ${
              totalRows > 0
                ? `
              <div class="pagination">
                <span>Page ${page} of ${totalPages} (${totalRows} rows)</span>
                ${page > 1 ? `<a href="${getPaginationLink(1)}">First</a>` : ""}
                ${
                  page > 1
                    ? `<a href="${getPaginationLink(page - 1)}">Previous</a>`
                    : ""
                }
                <span class="current">${page}</span>
                ${
                  page < totalPages
                    ? `<a href="${getPaginationLink(page + 1)}">Next</a>`
                    : ""
                }
                ${
                  page < totalPages
                    ? `<a href="${getPaginationLink(totalPages)}">Last</a>`
                    : ""
                }
              </div>
            `
                : ""
            }
            
            <div style="overflow-x: auto;">
              <table>
                <thead>
                  <tr>
                    ${tableInfo
                      .map(
                        (col) => `
                      <th>
                        <a href="${getSortLink(col.name)}">
                          ${col.name}
                          ${
                            sortColumn === col.name
                              ? `
                            <span class="sort-arrow ${sortDirection}"></span>
                          `
                              : ""
                          }
                        </a>
                      </th>
                    `,
                      )
                      .join("")}
                  </tr>
                </thead>
                <tbody>
                  ${
                    rows.length === 0
                      ? `
                    <tr>
                      <td colspan="${tableInfo.length}" class="empty-message">
                        No data found${
                          filterColumn && filterValue
                            ? " matching the filter"
                            : ""
                        }.
                      </td>
                    </tr>
                  `
                      : rows
                          .map(
                            (row) => `
                    <tr>
                      ${tableInfo
                        .map((col) => {
                          const value = row[col.name];
                          const displayValue =
                            value === null
                              ? "<null>"
                              : typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value);
                          return `<td title="${displayValue}">${displayValue}</td>`;
                        })
                        .join("")}
                    </tr>
                  `,
                          )
                          .join("")
                  }
                </tbody>
              </table>
            </div>
            
            ${
              totalPages > 1
                ? `
              <div class="pagination">
                <span>Page ${page} of ${totalPages} (${totalRows} rows)</span>
                ${page > 1 ? `<a href="${getPaginationLink(1)}">First</a>` : ""}
                ${
                  page > 1
                    ? `<a href="${getPaginationLink(page - 1)}">Previous</a>`
                    : ""
                }
                <span class="current">${page}</span>
                ${
                  page < totalPages
                    ? `<a href="${getPaginationLink(page + 1)}">Next</a>`
                    : ""
                }
                ${
                  page < totalPages
                    ? `<a href="${getPaginationLink(totalPages)}">Last</a>`
                    : ""
                }
              </div>
            `
                : ""
            }
          </div>
        </body>
      </html>
    `;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    return new Response(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      {
        status: 500,
        headers: { "Content-Type": "text/html" },
      },
    );
  }
}
