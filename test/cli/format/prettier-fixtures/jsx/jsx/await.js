async function testFunction() {
  const short = <>
    {await Promise.all(
      hierarchyCriticism
    )}
    {await hierarchyCriticism.ic.me.oa.p}
    {await hierarchyCriticism}

    {Promise.all(
      hierarchyCriticism
    )}
    {hierarchyCriticism.ic.me.oa.p}
    {hierarchyCriticism}
  </>

  const long = <>
    {await Promise.all(
      hierarchyCriticismIncongruousCooperateMaterialEducationOriginalArticulateParameter
    )}
    {await hierarchyCriticism.IncongruousCooperate.MaterialEducation.OriginalArticulate.Parameter}
    {await hierarchyCriticismIncongruousCooperateMaterialEducationOriginalArticulateParameter}

    {Promise.all(
      hierarchyCriticismIncongruousCooperateMaterialEducationOriginalArticulateParameter
    )}
    {hierarchyCriticism.IncongruousCooperate.MaterialEducation.OriginalArticulate.Parameter}
    {hierarchyCriticismIncongruousCooperateMaterialEducationOriginalArticulateParameter}
  </>

  const jsx = <>
    {await (<IncongruousCooperate>
      material education original articulate parameter
    </IncongruousCooperate>)}
  </>
}
