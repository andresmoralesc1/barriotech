// Note 2026-07-21: this file is intentionally one big static component. It's
// 447 lines of legal text (Ley 1581 de 2012), not interactive code. Splitting
// it into 9 section-components would make typo fixes a 9-file edit and
// wouldn't reduce bundle size (everything renders on /privacidad anyway).
// If we ever need dynamic policy versioning or A/B testing, migrate to a
// .md file rendered with react-markdown — until then, keep it monolithic.
import Link from 'next/link'

const POLICY_VERSION = 'v1.0'
const POLICY_EFFECTIVE = '28 de junio de 2026'

export function PrivacidadView() {
  return (
    <div className="marketing-page min-h-screen bg-background-cream">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          Política de Tratamiento de Datos Personales
        </h1>
        <p className="text-gray-500 text-sm mb-2">
          Versión: <span className="font-mono">{POLICY_VERSION}</span> ·
          {' '}Vigente desde: {POLICY_EFFECTIVE}
        </p>
        <p className="text-gray-500 text-sm mb-8">
          BarrioTech · Colombia
        </p>

        <div className="prose prose-gray max-w-none space-y-8">
          {/* 1. Identificación del responsable */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              1. Responsable del tratamiento
            </h2>
            <p className="text-gray-600 mb-3">
              BarrioTech, en adelante <strong>la Plataforma</strong>, actúa como
              Responsable del Tratamiento de los datos personales recolectados a
              través del sitio web <code>barriotech.com.co</code> y la
              aplicación móvil (cuando esté disponible), conforme a la{' '}
              <strong>Ley 1581 de 2012</strong> y el{' '}
              <strong>Decreto 1377 de 2013</strong> de Colombia.
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>
                <strong>Razón social / Persona natural:</strong> Andrés Morales
                (en proceso de constitución como persona jurídica)
              </li>
              <li>
                <strong>Domicilio:</strong> Bogotá D.C., Colombia
              </li>
              <li>
                <strong>Correo de contacto para temas de datos personales:</strong>{' '}
                <a
                  href="mailto:privacidad@barriotech.com"
                  className="text-primary-700 underline"
                >
                  privacidad@barriotech.com
                </a>
              </li>
              <li>
                <strong>Canal para derechos ARCO:</strong> mismo correo
                electrónico (tiempo de respuesta: máximo 15 días hábiles)
              </li>
            </ul>
          </section>

          {/* 2. Definiciones */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              2. Definiciones
            </h2>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>
                <strong>Dato personal:</strong> cualquier información vinculada
                o que pueda asociarse a una persona natural identificada o
                identificable.
              </li>
              <li>
                <strong>Tratamiento:</strong> cualquier operación sobre datos
                personales (recolección, almacenamiento, uso, circulación o
                supresión).
              </li>
              <li>
                <strong>Titular:</strong> persona natural cuyos datos personales
                son objeto de tratamiento.
              </li>
              <li>
                <strong>Derechos ARCO:</strong> Acceso, Rectificación,
                Cancelación y Oposición.
              </li>
            </ul>
          </section>

          {/* 3. Datos que recolectamos */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              3. Datos personales que recolectamos
            </h2>
            <p className="text-gray-600 mb-3">
              Recolectamos únicamente los datos necesarios para las finalidades
              descritas en la sección 4:
            </p>

            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              3.1. Datos de registro (todos los usuarios)
            </h3>
            <ul className="list-disc pl-6 text-gray-600 space-y-1 mb-4">
              <li>Correo electrónico (identificador único de la cuenta).</li>
              <li>Contraseña (almacenada con hash bcrypt — nunca en texto plano).</li>
              <li>Rol seleccionado: comprador o vendedor.</li>
              <li>Fecha y hora del registro.</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              3.2. Datos de perfil
            </h3>
            <ul className="list-disc pl-6 text-gray-600 space-y-1 mb-4">
              <li>Nombre para mostrar.</li>
              <li>Número de teléfono (opcional).</li>
              <li>Ciudad.</li>
              <li>Fotografía de perfil (opcional).</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              3.3. Datos del vendedor (solo si tu rol es vendedor)
            </h3>
            <ul className="list-disc pl-6 text-gray-600 space-y-1 mb-4">
              <li>Nombre comercial del negocio.</li>
              <li>Descripción, categoría y productos ofrecidos.</li>
              <li>
                <strong>Ubicación GPS en tiempo real</strong> cuando marcas tu
                estado como "activo".
              </li>
              <li>Historial de actualizaciones de ubicación.</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              3.4. Datos generados por el uso
            </h3>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>
                Pedidos realizados o recibidos, favoritos, reseñas y
                calificaciones.
              </li>
              <li>
                Suscripciones a notificaciones push (endpoint + claves
                criptográficas por dispositivo).
              </li>
              <li>
                Registros de consentimientos otorgados (fecha, IP, versión de
                esta política aceptada).
              </li>
              <li>Logs técnicos del servidor (dirección IP, agente de navegador).</li>
            </ul>
          </section>

          {/* 4. Finalidades */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              4. Finalidades y bases legales
            </h2>
            <p className="text-gray-600 mb-3">
              Tus datos son tratados para las siguientes finalidades específicas:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>
                <strong>Prestar el servicio de geolocalización de vendedores.</strong>{' '}
                Base legal: ejecución del contrato (art. 6 Ley 1581).
              </li>
              <li>
                <strong>Gestionar tu cuenta y autenticación.</strong>{' '}
                Base legal: ejecución del contrato.
              </li>
              <li>
                <strong>Notificarte cuando un vendedor favorito esté activo o
                el estado de tus pedidos cambie.</strong>{' '}
                Base legal: consentimiento expreso (tú autorizas las
                notificaciones push al suscribirte).
              </li>
              <li>
                <strong>Mejorar la plataforma mediante análisis agregados de uso.</strong>{' '}
                Base legal: interés legítimo (art. 6 Ley 1581).
              </li>
              <li>
                <strong>Atender requerimientos de autoridades colombianas
                cuando sean procedentes.</strong>{' '}
                Base legal: deber legal (art. 6 Ley 1581).
              </li>
              <li>
                <strong>Prevenir fraude y garantizar la seguridad de la plataforma.</strong>{' '}
                Base legal: interés legítimo.
              </li>
            </ul>
            <p className="text-gray-600 mt-3">
              <strong>NO</strong> usamos tus datos para: publicidad
              personalizada, perfilamiento comercial, venta a terceros ni
              decisiones automatizadas que produzcan efectos jurídicos sobre
              ti.
            </p>
          </section>

          {/* 5. Cookies */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              5. Cookies y tecnologías similares
            </h2>
            <p className="text-gray-600 mb-3">
              BarrioTech utiliza cookies y almacenamiento local del navegador
              con las siguientes finalidades:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>
                <strong>Cookies estrictamente necesarias:</strong> mantienen tu
                sesión iniciada (token de autenticación). No pueden
                desactivarse sin impedir el funcionamiento.
              </li>
              <li>
                <strong>Almacenamiento local (localStorage):</strong> guarda tus
                preferencias (favoritos, última ubicación del mapa). No
                contiene datos personales identificables sin tu sesión.
              </li>
              <li>
                <strong>Service Worker (notificaciones push):</strong> requiere
                tu permiso explícito del navegador. Si lo otorgas, se registra
                una suscripción técnica que permite enviarte notificaciones.
              </li>
            </ul>
            <p className="text-gray-600 mt-3">
              <strong>No usamos cookies de terceros con fines de seguimiento,
              remarketing ni analítica publicitaria.</strong>
            </p>
          </section>

          {/* 6. Transferencias */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              6. Transferencia y transmisión a terceros
            </h2>
            <p className="text-gray-600 mb-3">
              Para operar el servicio compartimos datos con estos proveedores,
              quienes actúan como Encargados del Tratamiento:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>
                <strong>Supabase Inc.</strong> — autenticación y base de datos
                legada (EE. UU., cláusulas contractuales estándar).
              </li>
              <li>
                <strong>Mozilla / Google (Chrome Web Push)</strong> — entrega
                de notificaciones push a tu navegador.
              </li>
              <li>
                <strong>Resend (cuando esté activo)</strong> — envío de correos
                transaccionales.
              </li>
              <li>
                <strong>DigitalOcean / proveedor de hosting</strong> —
                infraestructura del servidor (puede estar fuera de Colombia).
              </li>
            </ul>
            <p className="text-gray-600 mt-3">
              Ningún proveedor está autorizado a usar tus datos para fines
              propios. Puedes solicitar el detalle de los acuerdos de
              tratamiento enviando un correo a{' '}
              <a
                href="mailto:privacidad@barriotech.com"
                className="text-primary-700 underline"
              >
                privacidad@barriotech.com
              </a>
              .
            </p>
          </section>

          {/* 7. Derechos ARCO */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              7. Tus derechos ARCO
            </h2>
            <p className="text-gray-600 mb-3">
              Como titular de los datos, tienes derecho a:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>
                <strong>Acceso:</strong> conocer qué datos tenemos sobre ti.{' '}
                <em>
                  Endpoint: <code>GET /api/account/export</code> (descarga JSON).
                </em>
              </li>
              <li>
                <strong>Rectificación:</strong> corregir datos inexactos o
                desactualizados desde tu perfil o solicitándolo por correo.
              </li>
              <li>
                <strong>Cancelación / Supresión:</strong> eliminar tu cuenta y
                todos los datos asociados.{' '}
                <em>
                  Endpoint: <code>DELETE /api/account</code> (eliminación
                  completa e irreversible).
                </em>
              </li>
              <li>
                <strong>Oposición:</strong> revocar los consentimientos otorgados
                (notificaciones, analítica). Configurable desde tu perfil.
              </li>
            </ul>
            <p className="text-gray-600 mt-3">
              <strong>Cómo ejercerlos:</strong> envía tu solicitud a{' '}
              <a
                href="mailto:privacidad@barriotech.com"
                className="text-primary-700 underline"
              >
                privacidad@barriotech.com
              </a>{' '}
              adjuntando copia de tu documento de identidad. Responderemos en
              un plazo máximo de <strong>15 días hábiles</strong> conforme al
              art. 14 de la Ley 1581.
            </p>
          </section>

          {/* 8. Conservación */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              8. Tiempo de conservación
            </h2>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>
                <strong>Datos de cuenta activa:</strong> mientras tu cuenta
                esté abierta.
              </li>
              <li>
                <strong>Datos de cuenta eliminada:</strong> eliminación
                inmediata y total. Excepción: registros contables y fiscales
                que la ley colombiana obligue a conservar (máximo 5 años).
              </li>
              <li>
                <strong>Logs de servidor:</strong> máximo 90 días, salvo
                investigaciones de seguridad en curso.
              </li>
              <li>
                <strong>Backups de base de datos:</strong> 7 días en
                almacenamiento diario + 4 semanas en almacenamiento semanal.
              </li>
            </ul>
          </section>

          {/* 9. Seguridad */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              9. Medidas de seguridad
            </h2>
            <p className="text-gray-600 mb-3">
              Implementamos medidas técnicas y administrativas para proteger
              tus datos:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-1">
              <li>Conexión HTTPS obligatoria (HTTP/2 + TLS).</li>
              <li>Contraseñas hasheadas con bcrypt (factor 10).</li>
              <li>
                Tokens de autenticación firmados con JWT (HS256) y rotación
                automática.
              </li>
              <li>
                Validación de entrada en todos los endpoints (incluida
                validación de coordenadas GPS dentro del territorio colombiano).
              </li>
              <li>Rate limiting en endpoints de autenticación.</li>
              <li>Backups automatizados diarios (ver sección 8).</li>
              <li>
                Auditorías periódicas del código y dependencias (ver{' '}
                <a
                  href="https://github.com/andresmoralesc1/barriotech"
                  className="text-primary-700 underline"
                >
                  repositorio público
                </a>
                ).
              </li>
            </ul>
          </section>

          {/* 10. Menores */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              10. Tratamiento de datos de menores
            </h2>
            <p className="text-gray-600">
              BarrioTech está dirigido a personas mayores de 18 años. Si
              identificamos que un menor de 14 años se ha registrado, procederemos
              a eliminar su cuenta inmediatamente. Para el rango de 14 a 17 años,
              se requiere autorización previa del representante legal conforme al
              art. 7 de la Ley 1581.
            </p>
          </section>

          {/* 11. Cambios */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              11. Cambios a esta política
            </h2>
            <p className="text-gray-600">
              Cualquier cambio material será notificado dentro de la plataforma
              con al menos 15 días calendario de anticipación. La versión vigente
              estará siempre disponible en esta URL. Si los cambios afectan
              finalidades o bases legales, solicitaremos un nuevo consentimiento
              expreso.
            </p>
          </section>

          {/* 12. Autoridad de control */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              12. Autoridad de control y quejas
            </h2>
            <p className="text-gray-600">
              Si consideras que tus derechos han sido vulnerados o deseas
              presentar una queja, puedes acudir a la{' '}
              <strong>Superintendencia de Industria y Comercio (SIC)</strong>{' '}
              autoridad nacional de protección de datos personales en Colombia.
              Antes de hacerlo, te invitamos a contactarnos directamente para
              intentar resolver tu inquietud en{' '}
              <a
                href="mailto:privacidad@barriotech.com"
                className="text-primary-700 underline"
              >
                privacidad@barriotech.com
              </a>
              .
            </p>
          </section>

          {/* 13. Vigencia */}
          <section>
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              13. Vigencia
            </h2>
            <p className="text-gray-600">
              Esta política entró en vigencia el <strong>{POLICY_EFFECTIVE}</strong>{' '}
              y se encuentra en su versión <code>{POLICY_VERSION}</code>.
            </p>
          </section>
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  )
}
